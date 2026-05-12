# Ticket #1129537 — Sentinel Override Pickup Prompt

Paste the block below into Sentinel Override on the remote computer's browser
(the one with viewLinc open at 192.168.100.12), then click Send.

Recommended settings before sending:
- **Mode:** AUTONOMOUS  (turn approval off — this is a long, multi-step OQ flow)
- **Adaptive Prompts:** Auto (with v3.36.0 the new ambio_viewlinc profile will fire)
- **Adaptive Expansion mode:** Light  (the goal is already well-structured; don't let the rewriter add phases)
- **Telemetry Persistence:** ON  (so the run is recoverable if the SW dies mid-flight — open Past Runs in the panel to resume)
- **Ticket Mode:** ON, format FINAL_NOTES

---

## Paste this into Sentinel Override

```
Ticket: #1129537
Client: Ambio, Inc.
System: Ambio viewLinc 5.2.1.859 at https://192.168.100.12 (server AMBRX-FS01)
Mode: AUTONOMOUS
Technician: Brandon Goolsby (Premier Networx, support@augustaitguys.com, 706-426-6313)

PICKUP CONTEXT — these steps are ALREADY DONE, do not redo them:
- OQ-TEST-ALARM-001 location is already created under Ambio, Inc. > Temperature (°C). No channel is linked. Do NOT re-link.
- All 7 RFL100 channels under ap10a-x0859688 are confirmed bound 1:1 to production locations. viewLinc enforces this; do NOT attempt re-linking.
- Email relay is confirmed: host mail.ambiorx.com, port 25, no auth, sender viewlinc-alerts@ambiorx.com.
- IQ is complete. OQ 9.2 (Event Log) is documented as FAIL/known limitation. OQ 9.3 and 9.4 are PASS.
- Previous session ended on the Sites page looking for a live location.

GOAL: Complete OQ 9.12 (email alarm notification), OQ 9.15 (LOW threshold), and OQ 9.16 (HIGH threshold) for ticket #1129537 by creating two disposable test thresholds on a live production location, verifying email delivery to 3 recipients, then cleaning up.

EXECUTION PLAN — follow in order, do not skip steps:

STEP 1 — Identify TEST LOCATION
- Navigate to Sites (top menu). If you're already on Sites, stay.
- Scan the location list under Ambio, Inc. for any row with: a numeric current reading (NOT blank, NOT "No device"), device status OK (or "Device calibration" only if a value is present), and NOT currently in an active threshold alarm.
- Candidate locations to check first (already known to be channel-bound):
    5C chamber (AMB-031)
    5C Stability Chamber (AMB-028)
    25C and 30C Stability Chamber
    -20C Chamber (AMB-036)
    -20C Chamber AMB-061
    25C and 60% / 40C and 75% Stability Chamber
- Extract (key=test_location_name) the chosen location name.
- Extract (key=test_location_reading) the current numeric value with units.
- Extract (key=test_location_reading_timestamp) the reading timestamp from the row.
- Note that this location was chosen for OQ 9.12/9.15/9.16 due to viewLinc's 1:1 channel-to-location constraint preventing use of the empty OQ-TEST-ALARM-001 placeholder.

STEP 2 — OQ 9.12: HIGH threshold + email notification
- Navigate to Admin > Sites Manager.
- Select the TEST LOCATION in the left tree.
- Click the "Threshold Alarm Settings" tab in the right panel.
- BEFORE adding anything, read and note any pre-existing thresholds — extract (key=preexisting_thresholds) as a list. You will need this for cleanup.
- Click Add (or +) to create a new threshold.
- Configure:
    Name: OQ-9.12-TEST
    HIGH value: (test_location_reading minus 2.0) — this guarantees the current reading already exceeds it and fires immediately.
    Other thresholds (HH, Low, LL): leave blank or disabled.
    Enabled: YES.
    Notification delay: 0 minutes.
- Add notification recipients (Email method, immediate):
    sivakumar.madam@ambiorx.com
    pavan.jaini@ambiorx.com
    vinay.kolaraswath@ambiorx.com
- Save.
- Navigate to Alarms (top menu).
- wait_for_text "OQ-9.12-TEST" with timeout 300 seconds (5 minutes).
- Once it appears: extract (key=oq912_alarm_id) the Alarm ID, (key=oq912_threshold_value) the threshold value shown in the row, (key=oq912_alarm_type) the type (expect HIGH), and (key=oq912_trigger_ts) the trigger timestamp.
- Take a screenshot.
- Switch to the email inbox tab (separate browser tab — NOT inside viewLinc).
- Look for an email with subject containing "OQ-9.12-TEST" or "OQ" or "viewLinc". Extract (key=oq912_email_subject), (key=oq912_email_sender), (key=oq912_email_recipient), (key=oq912_email_received_ts).
- Take a screenshot of the email.
- Return to viewLinc Alarms tab. Acknowledge the OQ-9.12-TEST alarm. Comment: "OQ 9.12 test acknowledgement, ticket 1129537".
- Extract (key=oq912_ack_ts) the acknowledgement timestamp.
- Note (key=oq912_result): PASS if the email was received within 5 minutes; FAIL otherwise.

STEP 3 — OQ 9.16: HIGH threshold verification
- The OQ-9.12-TEST alarm WAS a HIGH threshold alarm, which satisfies OQ 9.16 by cross-reference.
- Note (key=oq916_result): PASS — cross-references oq912_alarm_id and oq912_email_subject as evidence.
- DO NOT create a second HIGH threshold unless Step 2 somehow used a non-HIGH alarm.

STEP 4 — OQ 9.15: LOW threshold
- Return to Admin > Sites Manager. Select the same TEST LOCATION. Click Threshold Alarm Settings.
- Click Add to create a second threshold.
- Configure:
    Name: OQ-9.15-TEST
    LOW value: (test_location_reading PLUS 2.0) — current reading is already below this LOW, fires immediately.
    Other thresholds: blank/disabled.
    Enabled: YES.
    Notification delay: 0.
- Same 3 recipients, email, immediate.
- Save.
- Navigate to Alarms. wait_for_text "OQ-9.15-TEST" timeout 300s.
- Extract (key=oq915_alarm_id), (key=oq915_threshold_value), (key=oq915_alarm_type) (expect LOW), (key=oq915_trigger_ts).
- Screenshot.
- Switch to email tab. Look for the low-threshold email. Extract (key=oq915_email_subject), (key=oq915_email_sender), (key=oq915_email_recipient), (key=oq915_email_received_ts).
- Screenshot the email.
- Return to viewLinc. Acknowledge OQ-9.15-TEST. Comment: "OQ 9.15 test acknowledgement, ticket 1129537".
- Extract (key=oq915_ack_ts).
- Note (key=oq915_result): PASS or FAIL on same email-within-5-min criterion.

STEP 5 — CLEANUP (MANDATORY — do not skip)
- Admin > Sites Manager. Select TEST LOCATION. Threshold Alarm Settings tab.
- Delete the threshold named OQ-9.12-TEST. Confirm.
- Delete the threshold named OQ-9.15-TEST. Confirm.
- Verify the remaining threshold list MATCHES the preexisting_thresholds memory key from Step 2. If anything is missing or different, note it as a deviation — DO NOT attempt to restore anything yourself (escalate manually).
- Navigate to Alarms. Confirm no unacknowledged OQ-* alarms remain.
- DO NOT delete the OQ-TEST-ALARM-001 location — that is permanent OQ documentation.

STEP 6 — Event Log evidence (OQ 9.2 supplement)
- Navigate to Event Log.
- Extract (key=eventlog_max_id_after) the current maximum Event ID.
- Note that the prior session ended at Event ID 471. Extract (key=eventlog_new_entry_count) the count of Event IDs greater than 471.
- Filter the Event Log for events related to threshold creation/deletion in this session. Extract (key=eventlog_oq_entries) a list of the new entries' (id, time, type, location, description).

DELIVERABLE — finish summary MUST contain (use the FINAL_NOTES ticket format):
- Action Taken bullet list including:
    Test location name chosen + rationale ("production location used due to viewLinc 1:1 channel mapping constraint preventing use of OQ-TEST-ALARM-001 placeholder").
    Current temperature reading at test start (value + timestamp).
    OQ 9.12: alarm ID, HIGH threshold value, trigger timestamp, email subject, email received timestamp, PASS/FAIL.
    OQ 9.15: alarm ID, LOW threshold value, trigger timestamp, email subject, email received timestamp, PASS/FAIL.
    OQ 9.16: PASS with cross-reference to OQ 9.12 HIGH evidence.
    Cleanup confirmation: OQ-9.12-TEST and OQ-9.15-TEST removed, alarms acknowledged, pre-existing thresholds restored.
    Event Log: max ID before 471 → after [eventlog_max_id_after], [eventlog_new_entry_count] new entries.
- Contact Attempt Details: viewLinc UI session conducted via Sentinel Override at [timestamp], remote-connected.
- Next Step and Time: None required if all results PASS. Ticket closes after OQ binder cross-references this output.
- Ownership Statement: Brandon Goolsby, Premier Networx — OQ 9.12, 9.15, 9.16 execution confirmed.

DEFENSIBILITY CONSTRAINT (read every step):
- Output style: timestamps, threshold values, alarm IDs, email subjects, device names, location names, current readings only.
- No speculation, no invention. Anything not provided/observed → mark [MISSING DATA — description].
- Mark anything unusual as "noteworthy" or "no evidence found".
- NEVER acknowledge a real production alarm — only alarms whose name starts with "OQ-".
- NEVER delete a threshold whose name does not start with "OQ-".
- NEVER re-link an RFL100 channel.
```

---

## Why this prompt is structured this way

The v3.36.0 ambio_viewlinc platform profile is registered, so when Sentinel
Override's URL/goal detection fires (the `192.168.100.12` host triggers it),
the Adaptive Prompts rewriter will silently add:

- knownSelectors for every viewLinc element (alarm table cells, threshold editor
  fields, Sites Manager tabs, Event Log columns)
- waitStrings ("Loading", "Saving", "Acknowledging")
- gotchas (5-minute fire delay, 1:1 channel binding, never-ack-real-alarms)
- rewriteInstructions reinforcing the "OQ-" naming convention for cleanup safety

The prompt itself also leans on Sentinel Override's existing patterns:

- `Mode: AUTONOMOUS` directive — v3.15.2 mode-mismatch detector confirms.
- Explicit `extract (key=...)` calls — the engine's memory hygiene from v3.13.0
  rejects empty/non-serializable values automatically.
- `wait_for_text` over polling — recovery skill library covers this.
- PICKUP CONTEXT section — prevents re-doing the v3.20.0-style "finish early"
  blocker by giving the agent a clear "already done" boundary.
- Defensibility constraint mirrors your user-preferences ticket-output style.

If the trust score from this run comes back below 60, the v3.31.0 suggestion
card will appear in chat — most likely "Re-run with approval mode" if there
was a failure cluster. Don't auto-retry on a GxP run — review the breakdown
and re-run manually if needed.
