# Runbook Mode

Create structured, repeatable investigation workflows for IT tasks. Runbooks let you define multi-step procedures that the agent executes systematically — perfect for troubleshooting, audits, and routine checks.

---

## What is a Runbook?

A runbook is a pre-defined sequence of steps that the agent follows to investigate or resolve an IT issue. Unlike one-off goals, runbooks are:

- **Repeatable** — Run the same investigation multiple times
- **Structured** — Each step has a clear purpose and expected outcome
- **Auditable** — Every step's result is logged for review
- **Shareable** — Save and share runbooks with your team

---

## Creating a Runbook

### Method 1: Natural Language

Describe your investigation as a structured goal:

```
Runbook: Check M365 User Health
1. Go to admin.microsoft.com
2. Navigate to Active users
3. Search for the target user
4. Check their license status
5. Check their sign-in activity (last 7 days)
6. Check MFA status
7. Report findings as a summary
```

The agent will decompose this into executable steps and ask for confirmation before running.

### Method 2: Save as a Shortcut

For frequently-used runbooks, save them as shortcuts:

1. Click the **📋** icon in the sidebar
2. Enter a name: `m365-user-health`
3. Paste your runbook description
4. Click **Save**

To run it later: type `/m365-user-health` in the goal input.

### Method 3: JSON Plan (Advanced)

For precise control, provide a JSON plan directly:

```json
{
  "plan_title": "M365 User Health Check",
  "steps": [
    { "step_number": 1, "action_type": "navigate", "description": "Go to M365 admin center", "url": "https://admin.microsoft.com" },
    { "step_number": 2, "action_type": "click", "description": "Click Users > Active users" },
    { "step_number": 3, "action_type": "type", "description": "Search for target user", "text": "john.doe@company.com" },
    { "step_number": 4, "action_type": "click", "description": "Click on the user result" },
    { "step_number": 5, "action_type": "read_page", "description": "Extract license and sign-in data" },
    { "step_number": 6, "action_type": "finish", "description": "Summarize findings" }
  ],
  "estimated_steps": 6,
  "warnings": ["User may need to re-authenticate if session expired"]
}
```

---

## Runbook Patterns

### Pattern 1: User Investigation

**Use case:** Gather information about a specific user across multiple systems.

```
Runbook: User Investigation
1. Go to M365 admin center → find user → extract license, MFA status, sign-in logs
2. Go to Azure AD → check group memberships
3. Go to Exchange admin → check mailbox rules and forwarding
4. Go to SharePoint → check recent file activity
5. Compile findings into a summary
```

**Best for:** Offboarding checks, security audits, troubleshooting access issues.

---

### Pattern 2: System Health Check

**Use case:** Verify that a system or service is functioning correctly.

```
Runbook: SonicWall Health Check
1. Navigate to SonicWall management IP
2. Log in with stored credentials
3. Check System > Status for uptime and firmware version
4. Check Network > Interfaces for link status
5. Check Firewall > Access Rules for any disabled rules
6. Check Log > Analyzer for recent errors (last 24h)
7. Export findings as summary
```

**Best for:** Daily checks, post-maintenance verification, incident response.

---

### Pattern 3: Configuration Audit

**Use case:** Verify that a system's configuration matches expected standards.

```
Runbook: M365 Security Audit
1. Go to M365 Security portal
2. Check Secure Score
3. Review Conditional Access policies
4. Check MFA registration status for all users
5. Review recent admin role changes
6. Check for any quarantined emails
7. Generate compliance summary
```

**Best for:** Compliance checks, security reviews, pre-audit preparation.

---

### Pattern 4: Data Extraction

**Use case:** Pull structured data from a web application.

```
Runbook: Extract All User Licenses
1. Go to M365 admin center > Active users
2. For each page of results:
   a. Extract user name, email, license, last sign-in
   b. Scroll to next page
3. Compile all users into a table
4. Export as JSON
```

**Best for:** Reporting, migration planning, license optimization.

---

### Pattern 5: Troubleshooting Flowchart

**Use case:** Follow a decision tree to diagnose an issue.

```
Runbook: Email Delivery Troubleshooting
1. Check Exchange mail flow for recent failures
2. If failures found → check the NDR details
3. If NDR says "mailbox full" → check mailbox quota
4. If NDR says "blocked" → check block list status
5. If no failures → check spam filter quarantine
6. If nothing in quarantine → check DNS MX records
7. Report root cause and recommended fix
```

**Best for:** Help desk escalation, recurring issues, knowledge transfer.

---

## Execution Flow

When you run a runbook, the agent follows this flow:

```
┌─────────────┐
│  Start       │
│  Runbook     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Plan        │ ── Agent decomposes goal into steps
│  Presented   │ ── You review and approve
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│  Execute     │────▶│  Step OK?   │
│  Step N      │     └──────┬──────┘
└─────────────┘            │
       │              Yes  │  No
       │                   │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│  Log Result  │     │  Auto-Tool  │
│  Step N+1    │     │  Recovery   │
└─────────────┘     └──────┬──────┘
       │                   │
       │              ┌────┴────┐
       │              │         │
       │           Fixed     Failed
       │              │         │
       ▼              ▼         ▼
┌─────────────┐     ┌─────────────┐
│  All Steps   │     │  Log Error  │
│  Complete?   │     │  Continue   │
└──────┬──────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│  Summary     │
│  Report      │
└─────────────┘
```

---

## Saving and Sharing Runbooks

### Save a Runbook

After a successful run, export the conversation:

1. Click **📋 Export** in the sidebar
2. Choose **Markdown** format
3. Save the file with a descriptive name: `m365-user-health-2026-04-28.md`

### Share a Runbook

Runbooks are just text — share them via:

- **Slack/Teams:** Paste the runbook description
- **Email:** Send as a document
- **Git:** Commit runbook files to a shared repository
- **Wiki:** Add to your team's knowledge base

### Import a Runbook

Paste a saved runbook description into the goal input and run it.

---

## Best Practices

### 1. Start Simple
Begin with 3–5 step runbooks. You can always add complexity later.

### 2. Be Specific
```
❌ "Check the admin portal"
✅ "Go to admin.microsoft.com > Users > Active users > search for john.doe@company.com"
```

### 3. Include Verification Steps
Add `read_page` steps to confirm the page is in the expected state before proceeding.

### 4. Handle Authentication
If the system requires login, either:
- Log in manually before running the runbook
- Include an `ask_user` step for credentials
- Use the extension's saved credentials feature (if available)

### 5. Plan for Failures
Include warnings about common failure points:
```
warnings: [
  "M365 may require re-authentication after 8 hours",
  "SonicWall may block automated login attempts",
  "Some pages may load slowly on VPN"
]
```

### 6. Review Before Executing
Always review the agent's plan before approving. Check that:
- Steps are in the right order
- No steps are missing
- The agent understood your intent correctly

---

## Example: M365 Offboarding Runbook

```
Runbook: M365 User Offboarding Check

Goal: Before disabling a user account, verify their current state.

Steps:
1. Go to admin.microsoft.com
2. Navigate to Users > Active users
3. Search for the target user
4. Extract: display name, licenses, groups, last sign-in
5. Go to Exchange admin center > Recipients > Mailboxes
6. Search for the user
7. Check: mailbox size, forwarding rules, shared mailboxes
8. Go to Azure AD > Users
9. Check: group memberships, app registrations, admin roles
10. Compile a pre-offboarding report with all findings

Warnings:
- User may have delegated access to shared mailboxes
- Check for active OAuth app registrations
- Verify no critical workflows depend on this account
```

---

*See also: [Getting Started](../GETTING_STARTED.md) · [Actions Reference](ACTIONS.md) · [Advanced Features](ADVANCED.md) · [Troubleshooting](TROUBLESHOOTING.md)*
