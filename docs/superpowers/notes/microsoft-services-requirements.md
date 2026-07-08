# Microsoft Services Requirements — BidBuddy
**Date:** 2026-07-08  
**Purpose:** IT access & permission request — internal briefing document  
**Application:** BidBuddy — iMocha's internal bid management platform

---

## Executive summary

BidBuddy requires access to five Microsoft service areas:

| # | Service | Status | Priority |
|---|---------|--------|----------|
| 1 | Microsoft Graph API + Azure App Registration | **Built, needs credentials** | P0 — already coded |
| 2 | Microsoft 365 Mail (SMTP / Graph Mail) | Not built | P0 — core workflow broken without it |
| 3 | Microsoft Entra ID (SSO) | Not built | P1 — usability |
| 4 | Microsoft Teams (webhooks) | Not built | P2 — planned |
| 5 | Outlook Calendar (Graph Calendar API) | Partially built | P2 — planned |

---

## 1. Microsoft Graph API — SharePoint Document Sync

### What it does
BidBuddy's Knowledge Hub (document store + AI search) can sync documents directly from SharePoint. When a pre-sales manager pastes a SharePoint share link, BidBuddy:
1. Authenticates to the Microsoft Graph API using the iMocha tenant
2. Downloads the file (PDF, DOCX, XLSX) from SharePoint/OneDrive
3. Stores it in BidBuddy's document store
4. AI-indexes it so the RFx Responder can search it

This is **fully coded and deployed** today. It is non-functional only because credentials have not been provisioned yet.

### What IT needs to create

**Azure App Registration** (in the iMocha Microsoft 365 tenant)

| Setting | Value |
|---------|-------|
| App type | Daemon / server-to-server (no user login) |
| Authentication | Client credentials (client secret) |
| Redirect URIs | None required |

**API permissions required (Application, not Delegated)**

| Permission | Scope | Why |
|-----------|-------|-----|
| `Sites.Read.All` | Microsoft Graph | Read SharePoint site files |
| `Files.Read.All` | Microsoft Graph | Download individual files and folder contents |

> Both are **read-only**. BidBuddy never writes back to SharePoint.

**Credentials to hand over**

- `tenantId` — the iMocha Azure AD tenant ID
- `clientId` — the App Registration's client (application) ID
- `clientSecret` — a client secret with reasonable expiry (12–24 months)

These are stored encrypted in BidBuddy's `org_settings` table and used only server-side. They are never exposed to the browser.

---

## 2. Microsoft 365 Mail — Email Notifications

### What it does (planned)
BidBuddy currently has an in-app notification centre (bell icon). Every significant event — new user signup, bid stage change, deadline alert, contract approval request — creates an in-app notification. **No email is sent today.**

This is a critical gap. When an admin approves a new user, the user has no way of knowing unless they happen to check the app. When a legal reviewer needs to approve a contract, they get an in-app badge but no email prompt.

### Where emails need to fire

| Trigger | Recipients | Urgency |
|---------|-----------|---------|
| New user signed up (pending approval) | Admin users | P0 |
| User account approved | The new user | P0 |
| User account rejected | The new user | P0 |
| Bid assigned to team member | Assignee | P1 |
| Contract approval requested (legal stage) | Legal role users | P1 |
| Contract approval requested (finance stage) | Finance role users | P1 |
| Bid deadline within 3 days | Assigned team | P1 |
| Bid advanced to new stage | Assigned team | P2 |
| Go/No-Go decision recorded | Pre-sales lead | P2 |
| Question/deliverable assigned to me | Assignee | P2 |

### Options (IT to advise preferred method)

**Option A — Microsoft Graph Mail API** (recommended for Microsoft 365 tenants)
- BidBuddy's server calls `POST /v1.0/users/{sender}/sendMail` via Graph
- Sends from a shared mailbox (e.g. `bidbuddy@imocha.io` or `noreply@imocha.io`)
- Same App Registration as SharePoint (add `Mail.Send` permission for the shared mailbox only)
- Emails appear as sent from an iMocha address, not a third-party

**Option B — SMTP relay via Microsoft 365**
- Standard SMTP relay using iMocha's Exchange connector
- Requires an SMTP endpoint, port 587 or 465, and an app password

**What BidBuddy needs from IT**

For Option A:
- `Mail.Send` permission added to the existing App Registration (above)
- A dedicated shared mailbox (e.g. `bidbuddy@imocha.io`) that the app can send from, **or** permission to send from an existing no-reply address

For Option B:
- SMTP hostname, port, sender address, and app password / service account credentials

---

## 3. Microsoft Entra ID (Azure AD) — Single Sign-On

### What it does (planned)
BidBuddy currently uses email + password authentication via Supabase Auth. Every iMocha employee needs a separate BidBuddy account. With Entra ID SSO:
- Employees sign in with their existing Microsoft corporate credentials ("Sign in with Microsoft")
- No separate password to manage
- Account access is automatically revoked when an employee offboards from iMocha's directory
- Admin doesn't need to manually create or delete accounts

### What IT needs to create

**Azure App Registration (separate from the Graph/SharePoint one)**

| Setting | Value |
|---------|-------|
| App type | Web application with user login |
| Authentication | OAuth 2.0 / OIDC (Authorization Code flow) |
| Redirect URI | `https://[bidbuddy-domain]/auth/callback/azure` |
| Token type | ID Token + Access Token |

**Permissions required (Delegated)**

| Permission | Why |
|-----------|-----|
| `openid` | Standard OIDC login |
| `profile` | User's display name |
| `email` | User's email address |
| `User.Read` | Read the signed-in user's profile |

**Who should be allowed to sign in**
- Option 1: All iMocha employees (entire tenant) — simplest
- Option 2: Specific security group only (e.g. "BidBuddy Users") — tighter control, requires group membership management

**Credentials to hand over**
- `tenantId`
- `clientId` (of this new App Registration)
- `clientSecret`

---

## 4. Microsoft Teams — Notifications (Planned)

### What it does
Instead of (or in addition to) email, BidBuddy would post notifications to a Microsoft Teams channel or to individual users via the Teams Bot API. This means:
- A "BidBuddy" bot posts in a `#bidbuddy-alerts` Teams channel when a bid advances, a deadline is near, or a contract approval is needed
- Personal notifications land in the Teams activity feed for the assigned user

### What IT needs to create

**Option A — Incoming Webhook (simpler, no bot)**
- IT creates an Incoming Webhook connector in the target Teams channel
- BidBuddy posts a JSON payload to a webhook URL
- No App Registration needed
- Limitation: one-way only, can't address individual users

**Option B — Teams Bot via Azure Bot Service (full, future)**
- Azure Bot registration
- `TeamsActivity.Send` permission (Delegated or Application)
- Can send proactive messages to individual users
- Higher complexity — requires bot framework setup

**For now:** Incoming webhook per channel is sufficient and can be set up without IT involvement if the Teams admin grants channel connector rights.

---

## 5. Outlook Calendar — Bid Deadline Sync (Partially Built)

### What it does
BidBuddy has a Calendar page (`/calendar`) showing bid deadlines and custom events on a React Big Calendar view. It is currently in-app only. The planned upgrade:
- Sync bid deadlines to each team member's Outlook calendar automatically
- When a bid deadline changes, update the calendar event
- Add orals presentation dates, clarification submission deadlines as separate calendar events

### What IT needs to create

Uses the **same App Registration as email/SharePoint** with one additional permission:

| Permission | Type | Why |
|-----------|------|-----|
| `Calendars.ReadWrite` | Delegated (per user) | Create/update events on the user's calendar |

**Delegation model:** Each user grants BidBuddy permission to write to their calendar on first login (OAuth consent screen). No admin-level calendar access needed.

**Alternative — shared team calendar:**
- IT creates a shared calendar (`BidBuddy Pipeline Calendar`)
- BidBuddy writes all deadlines there via `Calendars.ReadWrite` (Application, for the shared calendar only)
- All team members subscribe to this calendar in Outlook

---

## Consolidated permissions request

If IT creates **two App Registrations**:

**App 1 — BidBuddy Server (daemon, no user login)**

| Permission | Type | Used for |
|-----------|------|---------|
| `Sites.Read.All` | Application | SharePoint document sync |
| `Files.Read.All` | Application | SharePoint file download |
| `Mail.Send` | Application (scoped to shared mailbox) | Outbound email notifications |
| `Calendars.ReadWrite` | Application (scoped to shared calendar, optional) | Shared team calendar sync |

**App 2 — BidBuddy Web (user login, SSO)**

| Permission | Type | Used for |
|-----------|------|---------|
| `openid`, `profile`, `email`, `User.Read` | Delegated | SSO login |
| `Calendars.ReadWrite` | Delegated | Per-user calendar event creation |

---

## Future Microsoft services (beyond current roadmap)

| Service | Use case | Likelihood |
|---------|---------|-----------|
| **Azure Document Intelligence** | Parse scanned PDF RFPs (table extraction, form fields) — current DOCX/PDF parsing is text-only | Medium |
| **Microsoft Purview (Information Protection)** | Mark BidBuddy-generated proposals with iMocha sensitivity labels before sending externally | Low |
| **Power BI Embedded** | Embed win-rate and pipeline analytics dashboards in BidBuddy's Analytics page, powered by Power BI rather than custom D3 | Low |
| **OneDrive personal drive sync** | Pre-sales team members sync their personal OneDrive folders as a knowledge source (same API as SharePoint, already coded) | High — already works via existing SharePoint sync |
| **Microsoft Copilot extensibility** | Surface BidBuddy bid context inside Microsoft 365 Copilot (e.g. "show me the Apex Capital bid status in Teams") — via Graph Connector or Copilot plugin | Future |
| **Azure Communication Services** | SMS/WhatsApp deadline alerts for mobile notifications | Low |

---

## Summary for IT request email

> BidBuddy needs two Azure App Registrations in the iMocha tenant:
>
> **App 1 (server-to-server, no user login):** SharePoint/OneDrive document read access (`Sites.Read.All`, `Files.Read.All`), ability to send email from a shared mailbox (`Mail.Send`), and optionally write to a shared calendar.
>
> **App 2 (user-facing, SSO):** Standard OIDC login permissions so iMocha employees can sign in with their Microsoft credentials.
>
> Additionally, a shared mailbox (e.g. `bidbuddy@imocha.io`) and optionally a Teams channel webhook for pipeline alerts.
>
> All access is read-only for documents. Email sending is one-way outbound. No write access to SharePoint or employee files.
