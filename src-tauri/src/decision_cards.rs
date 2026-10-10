//! Decision cards agents leave in a chat with `app chat.ask`. They live beside
//! the transcript rather than in it, so a card is found, retried and settled by
//! its request ID however little of a long conversation is loaded.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use tauri::State;

use crate::session_store::{self, SessionStore};

/// Settled cards a session loads besides its waiting ones, the newest first.
const LOADED_SETTLED: i64 = 200;
const MAX_CARD_BYTES: usize = 64 * 1024;

pub(crate) fn ensure_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS decision_cards (
           session_id TEXT NOT NULL,
           card_id TEXT NOT NULL,
           card_json TEXT NOT NULL,
           waiting INTEGER NOT NULL,
           PRIMARY KEY (session_id, card_id)
         );",
    )
}

fn invalid(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

fn stored(conn: &Connection, session_id: &str, card_id: &str) -> rusqlite::Result<Option<Value>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT card_json FROM decision_cards WHERE session_id = ?1 AND card_id = ?2",
            params![session_id, card_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw.and_then(|raw| serde_json::from_str(&raw).ok()))
}

/// Saves the card unless its request ID already named one, and returns the
/// card stored under that ID, waiting or not.
pub(crate) fn ask(conn: &Connection, session_id: &str, card: &Value) -> rusqlite::Result<Value> {
    let card_id = card["id"]
        .as_str()
        .ok_or_else(|| invalid("card needs an id"))?;
    let raw = card.to_string();
    if raw.len() > MAX_CARD_BYTES {
        return Err(invalid("card is too large"));
    }
    conn.execute(
        "INSERT OR IGNORE INTO decision_cards(session_id, card_id, card_json, waiting) VALUES (?1, ?2, ?3, ?4)",
        params![session_id, card_id, raw, card.get("outcome").is_none()],
    )?;
    stored(conn, session_id, card_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// Answers or dismisses a waiting card. A settled card keeps its first outcome.
pub(crate) fn settle(
    conn: &Connection,
    session_id: &str,
    card_id: &str,
    outcome: &Value,
) -> rusqlite::Result<Option<Value>> {
    let Some(mut card) = stored(conn, session_id, card_id)? else {
        return Ok(None);
    };
    if card.get("outcome").is_some() {
        return Ok(Some(card));
    }
    card["outcome"] = outcome.clone();
    conn.execute(
        "UPDATE decision_cards SET card_json = ?3, waiting = 0 WHERE session_id = ?1 AND card_id = ?2 AND waiting = 1",
        params![session_id, card_id, card.to_string()],
    )?;
    stored(conn, session_id, card_id)
}

/// Every waiting card and the latest settled ones, in the order they were asked.
pub(crate) fn list(conn: &Connection, session_id: &str) -> rusqlite::Result<Vec<Value>> {
    let mut statement = conn.prepare(
        "SELECT card_json FROM decision_cards WHERE session_id = ?1 AND (waiting = 1 OR rowid IN (
           SELECT rowid FROM decision_cards WHERE session_id = ?1 AND waiting = 0 ORDER BY rowid DESC LIMIT ?2
         )) ORDER BY rowid",
    )?;
    let rows = statement.query_map(params![session_id, LOADED_SETTLED], |row| {
        row.get::<_, String>(0)
    })?;
    Ok(rows
        .filter_map(|raw| raw.ok().and_then(|raw| serde_json::from_str(&raw).ok()))
        .collect())
}

pub(crate) fn delete_for_session(conn: &Connection, session_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM decision_cards WHERE session_id = ?1",
        [session_id],
    )?;
    Ok(())
}

fn ids(session_id: &str, card_id: &str) -> Result<(), String> {
    session_store::validate_id(session_id, "session")?;
    if card_id.len() > 128 {
        return Err("Invalid card id".into());
    }
    session_store::validate_id(card_id, "card")
}

#[tauri::command(async)]
pub fn decision_card_ask(
    store: State<'_, SessionStore>,
    session_id: String,
    card: Value,
) -> Result<Value, String> {
    ids(&session_id, card["id"].as_str().unwrap_or(""))?;
    let conn = store.lock_conn()?;
    ask(&conn, &session_id, &card).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn decision_card_settle(
    store: State<'_, SessionStore>,
    session_id: String,
    card_id: String,
    outcome: Value,
) -> Result<Option<Value>, String> {
    ids(&session_id, &card_id)?;
    let conn = store.lock_conn()?;
    settle(&conn, &session_id, &card_id, &outcome).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        ensure_table(&conn).unwrap();
        conn
    }

    #[test]
    fn a_repeated_request_id_returns_the_first_card_even_when_settled() {
        let conn = conn();
        let first = json!({"id": "ask-1", "turnId": "t1", "questions": [{"prompt": "Merge?"}]});
        assert_eq!(ask(&conn, "s", &first).unwrap(), first);
        let other = json!({"id": "ask-1", "turnId": "t9", "questions": [{"prompt": "Other?"}]});
        assert_eq!(ask(&conn, "s", &other).unwrap(), first);
        let dismissed = settle(&conn, "s", "ask-1", &json!({"kind": "dismissed", "at": 2}))
            .unwrap()
            .unwrap();
        assert_eq!(dismissed["outcome"]["kind"], "dismissed");
        assert_eq!(ask(&conn, "s", &first).unwrap(), dismissed);
        // The same request ID in another session is its own card.
        assert_eq!(ask(&conn, "other", &other).unwrap(), other);
    }

    #[test]
    fn a_settled_card_keeps_its_first_outcome() {
        let conn = conn();
        ask(&conn, "s", &json!({"id": "a", "questions": []})).unwrap();
        settle(&conn, "s", "a", &json!({"kind": "answered", "at": 1})).unwrap();
        let again = settle(&conn, "s", "a", &json!({"kind": "dismissed", "at": 2}))
            .unwrap()
            .unwrap();
        assert_eq!(again["outcome"]["kind"], "answered");
        assert!(settle(&conn, "s", "missing", &json!({"kind": "dismissed"}))
            .unwrap()
            .is_none());
    }

    #[test]
    fn loads_every_waiting_card_and_only_the_latest_settled_ones() {
        let conn = conn();
        ask(&conn, "s", &json!({"id": "oldest-waiting"})).unwrap();
        for index in 0..(LOADED_SETTLED + 5) {
            let id = format!("settled-{index}");
            ask(&conn, "s", &json!({ "id": id })).unwrap();
            settle(&conn, "s", &id, &json!({"kind": "dismissed"})).unwrap();
        }
        ask(&conn, "s", &json!({"id": "newest-waiting"})).unwrap();
        let ids: Vec<String> = list(&conn, "s")
            .unwrap()
            .iter()
            .map(|card| card["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids.len() as i64, LOADED_SETTLED + 2);
        assert_eq!(ids.first().unwrap(), "oldest-waiting");
        assert_eq!(ids[1], "settled-5");
        assert_eq!(ids.last().unwrap(), "newest-waiting");
        delete_for_session(&conn, "s").unwrap();
        assert!(list(&conn, "s").unwrap().is_empty());
    }
}
