//! Decision cards agents leave in a chat with `app chat.ask`. They live beside
//! the transcript rather than in it, so a card is found, retried and settled by
//! its request ID however little of a long conversation is loaded.
use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::session_store::{self, SessionStore};

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

/// A claim's result: the card as stored, and whether this caller settled it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    card: Option<Value>,
    claimed: bool,
}

/// Settles a waiting card with the first outcome to arrive, from any window.
/// Only the caller that claims it may send its answer; later claims change
/// nothing and learn the stored outcome.
pub(crate) fn claim(
    conn: &Connection,
    session_id: &str,
    card_id: &str,
    outcome: &Value,
) -> rusqlite::Result<Claim> {
    let Some(mut card) = stored(conn, session_id, card_id)? else {
        return Ok(Claim {
            card: None,
            claimed: false,
        });
    };
    if card.get("outcome").is_some() {
        return Ok(Claim {
            card: Some(card),
            claimed: false,
        });
    }
    card["outcome"] = outcome.clone();
    let changed = conn.execute(
        "UPDATE decision_cards SET card_json = ?3, waiting = 0 WHERE session_id = ?1 AND card_id = ?2 AND waiting = 1",
        params![session_id, card_id, card.to_string()],
    )?;
    Ok(Claim {
        card: stored(conn, session_id, card_id)?,
        claimed: changed == 1,
    })
}

/// Gives back a claim whose answer could not be sent, so the card waits again.
/// Another caller's outcome is left alone.
pub(crate) fn release(
    conn: &Connection,
    session_id: &str,
    card_id: &str,
    outcome: &Value,
) -> rusqlite::Result<Option<Value>> {
    let Some(mut card) = stored(conn, session_id, card_id)? else {
        return Ok(None);
    };
    if card.get("outcome") != Some(outcome) {
        return Ok(Some(card));
    }
    if let Some(fields) = card.as_object_mut() {
        fields.remove("outcome");
    }
    conn.execute(
        "UPDATE decision_cards SET card_json = ?3, waiting = 1 WHERE session_id = ?1 AND card_id = ?2",
        params![session_id, card_id, card.to_string()],
    )?;
    stored(conn, session_id, card_id)
}

/// The cards asked in the given turns, in the order they were asked, and with
/// `waiting` every waiting card too, wherever its turn is.
pub(crate) fn list(
    conn: &Connection,
    session_id: &str,
    turns: &HashSet<&str>,
    waiting: bool,
) -> rusqlite::Result<Vec<Value>> {
    let mut statement = conn.prepare(
        "SELECT card_json, waiting FROM decision_cards WHERE session_id = ?1 ORDER BY rowid",
    )?;
    let rows = statement.query_map([session_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
    })?;
    Ok(rows
        .filter_map(|row| row.ok())
        .filter_map(|(raw, is_waiting)| {
            let card: Value = serde_json::from_str(&raw).ok()?;
            let in_turn = card["turnId"]
                .as_str()
                .is_some_and(|turn| turns.contains(turn));
            (in_turn || (waiting && is_waiting)).then_some(card)
        })
        .collect())
}

/// The ids of loaded blocks, which name the turns their cards were asked in.
pub(crate) fn block_ids(blocks: &[Value]) -> HashSet<&str> {
    blocks
        .iter()
        .filter_map(|block| block["id"].as_str())
        .collect()
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
pub fn decision_card_claim(
    store: State<'_, SessionStore>,
    session_id: String,
    card_id: String,
    outcome: Value,
) -> Result<Claim, String> {
    ids(&session_id, &card_id)?;
    let conn = store.lock_conn()?;
    claim(&conn, &session_id, &card_id, &outcome).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn decision_card_release(
    store: State<'_, SessionStore>,
    session_id: String,
    card_id: String,
    outcome: Value,
) -> Result<Option<Value>, String> {
    ids(&session_id, &card_id)?;
    let conn = store.lock_conn()?;
    release(&conn, &session_id, &card_id, &outcome).map_err(|e| e.to_string())
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

    fn ids(cards: &[Value]) -> Vec<&str> {
        cards
            .iter()
            .map(|card| card["id"].as_str().unwrap())
            .collect()
    }

    #[test]
    fn a_repeated_request_id_returns_the_first_card_even_when_settled() {
        let conn = conn();
        let first = json!({"id": "ask-1", "turnId": "t1", "questions": [{"prompt": "Merge?"}]});
        assert_eq!(ask(&conn, "s", &first).unwrap(), first);
        let other = json!({"id": "ask-1", "turnId": "t9", "questions": [{"prompt": "Other?"}]});
        assert_eq!(ask(&conn, "s", &other).unwrap(), first);
        let dismissed = claim(&conn, "s", "ask-1", &json!({"kind": "dismissed", "at": 2}))
            .unwrap()
            .card
            .unwrap();
        assert_eq!(dismissed["outcome"]["kind"], "dismissed");
        assert_eq!(ask(&conn, "s", &first).unwrap(), dismissed);
        // The same request ID in another session is its own card.
        assert_eq!(ask(&conn, "other", &other).unwrap(), other);
    }

    #[test]
    fn only_the_first_claim_wins_and_a_later_one_learns_its_outcome() {
        let conn = conn();
        ask(&conn, "s", &json!({"id": "a", "turnId": "t"})).unwrap();
        let yes = json!({"kind": "answered", "at": 1, "reply": {"answers": {"q1": ["yes"]}}});
        let no = json!({"kind": "answered", "at": 1, "reply": {"answers": {"q1": ["no"]}}});
        let first = claim(&conn, "s", "a", &yes).unwrap();
        assert!(first.claimed);
        let second = claim(&conn, "s", "a", &no).unwrap();
        assert!(!second.claimed);
        assert_eq!(second.card.unwrap()["outcome"], yes);
        assert!(!claim(&conn, "s", "missing", &yes).unwrap().claimed);
    }

    #[test]
    fn a_released_claim_waits_again_but_another_outcome_is_kept() {
        let conn = conn();
        ask(&conn, "s", &json!({"id": "a", "turnId": "t"})).unwrap();
        let yes = json!({"kind": "answered", "at": 1});
        let no = json!({"kind": "answered", "at": 2});
        claim(&conn, "s", "a", &yes).unwrap();
        // Someone else's outcome stays.
        assert_eq!(
            release(&conn, "s", "a", &no).unwrap().unwrap()["outcome"],
            yes
        );
        let released = release(&conn, "s", "a", &yes).unwrap().unwrap();
        assert!(released.get("outcome").is_none());
        let loaded = list(&conn, "s", &HashSet::new(), true).unwrap();
        assert_eq!(ids(&loaded), ["a"]);
        assert!(claim(&conn, "s", "a", &no).unwrap().claimed);
    }

    #[test]
    fn loads_waiting_cards_and_every_settled_card_of_the_loaded_turns() {
        let conn = conn();
        ask(&conn, "s", &json!({"id": "old-waiting", "turnId": "t-0"})).unwrap();
        // More settled cards than any cap, all in turns that are loaded.
        for index in 0..250 {
            let id = format!("settled-{index}");
            ask(
                &conn,
                "s",
                &json!({ "id": id, "turnId": format!("t-{index}") }),
            )
            .unwrap();
            claim(&conn, "s", &id, &json!({"kind": "dismissed"})).unwrap();
        }
        ask(&conn, "s", &json!({"id": "new-waiting", "turnId": "t-999"})).unwrap();
        let turns: Vec<String> = (0..250).map(|index| format!("t-{index}")).collect();
        let all: HashSet<&str> = turns.iter().map(String::as_str).collect();
        let loaded = list(&conn, "s", &all, true).unwrap();
        assert_eq!(loaded.len(), 252);
        assert_eq!(ids(&loaded)[..2], ["old-waiting", "settled-0"]);
        assert_eq!(*ids(&loaded).last().unwrap(), "new-waiting");
        // An older page brings only its own turns' cards.
        let page: HashSet<&str> = ["t-0", "t-1"].into_iter().collect();
        assert_eq!(
            ids(&list(&conn, "s", &page, false).unwrap()),
            ["old-waiting", "settled-0", "settled-1"]
        );
        // Nothing loaded: the waiting cards only.
        assert_eq!(
            ids(&list(&conn, "s", &HashSet::new(), true).unwrap()),
            ["old-waiting", "new-waiting"]
        );
        delete_for_session(&conn, "s").unwrap();
        assert!(list(&conn, "s", &all, true).unwrap().is_empty());
    }
}
