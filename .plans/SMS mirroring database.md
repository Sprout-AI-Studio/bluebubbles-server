# SMS/MMS/RCS Mirror Database

## Context

BlueBubbles reads Apple's iMessage database (`~/Library/Messages/chat.db`) which contains ALL message types — iMessage, SMS, MMS, RCS. We want a separate SQLite database that mirrors only non-iMessage threads. This is write-only for now — nothing reads from it yet. All messages continue flowing normally through the existing pipeline; non-iMessage data gets **additionally** written to a separate DB as a "tap" on the existing event stream.

---

## Step 1: Config Default

**File:** `packages/server/src/server/databases/server/constants.ts`

Add to `DEFAULT_DB_ITEMS`:
```typescript
sms_mirror_enabled: () => 0,
```

---

## Step 2: Mirror DB Entities

**New directory:** `packages/server/src/server/databases/smsMirror/entity/`

Slim entities — essential fields only, dates stored as epoch ms (plain integers), booleans use existing `BooleanTransformer` from `@server/databases/transformers/BooleanTransformer`.

### SmsMessage.ts
| Column | Type | Notes |
|--------|------|-------|
| `id` | PrimaryGeneratedColumn | Our own PK |
| `originalRowId` | integer | Apple's ROWID for correlation |
| `guid` | text, unique | Apple's message GUID |
| `text` | text, nullable | Message body |
| `subject` | text, nullable | |
| `service` | text | "SMS", "RCS", "MMS" |
| `account` | text, nullable | |
| `isFromMe` | boolean (BooleanTransformer) | |
| `dateCreated` | integer, nullable | Epoch ms |
| `dateDelivered` | integer, nullable | Epoch ms |
| `dateRead` | integer, nullable | Epoch ms |
| `error` | integer, default 0 | |
| `isRead` | boolean | |
| `isSent` | boolean | |
| `isDelivered` | boolean | |
| `groupTitle` | text, nullable | |
| `associatedMessageGuid` | text, nullable | Reactions/replies |

**Relations:**
- `handle` → ManyToOne to SmsHandle
- `chats` → ManyToMany to SmsChat (via `sms_chat_message_join`)
- `attachments` → ManyToMany to SmsAttachment (via `sms_message_attachment_join`)

### SmsChat.ts
| Column | Type |
|--------|------|
| `id` | PrimaryGeneratedColumn |
| `originalRowId` | integer |
| `guid` | text, unique |
| `style` | integer, nullable (43=group, 45=individual) |
| `chatIdentifier` | text, nullable |
| `serviceName` | text, nullable |
| `displayName` | text, nullable |
| `roomName` | text, nullable |

**Relations:** `participants` → ManyToMany to SmsHandle (via `sms_chat_handle_join`), `messages` → ManyToMany to SmsMessage

### SmsHandle.ts
| Column | Type |
|--------|------|
| `id` | PrimaryGeneratedColumn |
| `originalRowId` | integer |
| `address` | text (phone/email — equiv to Handle.id) |
| `service` | text |
| `country` | text, nullable |

### SmsAttachment.ts (metadata only)
| Column | Type |
|--------|------|
| `id` | PrimaryGeneratedColumn |
| `originalRowId` | integer |
| `guid` | text, unique |
| `filePath` | text, nullable |
| `mimeType` | text, nullable |
| `transferName` | text, nullable |
| `totalBytes` | integer, default 0 |
| `isOutgoing` | boolean |

---

## Step 3: SmsRepository

**New file:** `packages/server/src/server/databases/smsMirror/index.ts`

Follow `ServerRepository` pattern (`packages/server/src/server/databases/server/index.ts`):
- DataSource name: `"sms-mirror"`, type: `"better-sqlite3"`
- DB path: `{userData}/sms-mirror.db` (dev: `{userData}/bluebubbles-server/sms-mirror.db`)
- `synchronize: true` (new DB, no migrations needed yet)
- Convenience methods: `messages()`, `chats()`, `handles()`, `attachments()` returning TypeORM repositories

---

## Step 4: SmsMirrorService

**New file:** `packages/server/src/server/services/smsMirrorService/index.ts`

Extends `Loggable`. Pattern: `SlackAlertService` lifecycle + direct event listener registration.

```
class SmsMirrorService extends Loggable {
    tag = "SmsMirrorService"
    repo: SmsRepository

    start()   → initialize SmsRepository
    stop()    → destroy repo connection

    registerListeners(listener: IMessageListener)   → listener.on("new-entry", ...) etc.
    removeListeners(listener: IMessageListener)      → listener.removeListener(...)

    handleNewEntry(message: Message)      → filter non-iMessage → writeMessage()
    handleUpdatedEntry(message: Message)  → filter non-iMessage → updateMessage()

    writeMessage(message)   → upsert handle, chats, attachments, then insert message
    updateMessage(message)  → find by guid, update date/status fields only

    isNonIMessage(message)  → message.service && message.service !== "iMessage"
}
```

**Key behaviors:**
- Filter: `message.service !== "iMessage"` (catches SMS, MMS, RCS, future types)
- Upsert strategy: use TypeORM `save()` with unique constraints (guid/originalRowId) — inserts if new, updates if exists
- All writes wrapped in try/catch — failures logged but never propagate to main flow
- On `updated-entry`: only update message-level fields (dates, status), don't re-sync participants

---

## Step 5: Service Registration

**File:** `packages/server/src/server/services/index.ts` — add import + export

**File:** `packages/server/src/server/index.ts` — 5 changes:
1. Import `SmsMirrorService`
2. Property: `smsMirrorService: SmsMirrorService`
3. `initServices()`: instantiate `new SmsMirrorService()`
4. `startServices()`: if `sms_mirror_enabled`, call `start()` then in `startChatListeners()`, call `registerListeners(this.iMessageListener)`
5. `stopServices()`: call `stop()`
6. `handleConfigUpdate()`: when `sms_mirror_enabled` changes, start/stop + register/remove listeners

---

## Step 6: UI Toggle

**New file:** `packages/ui/src/app/components/fields/SmsMirrorEnabledField.tsx`
- Checkbox, pattern: `SlackAlertsEnabledField.tsx`
- Config key: `sms_mirror_enabled`
- Helper text: "Maintain a separate database mirroring SMS/MMS/RCS messages for independent tracking."

**New file:** `packages/ui/src/app/layouts/settings/smsMirror/SmsMirrorSettings.tsx`
- Simple section with just the toggle checkbox
- Pattern: `FeatureSettings.tsx` but minimal

**Modified:** `packages/ui/src/app/layouts/settings/SettingsLayout.tsx`
- Add `<SmsMirrorSettings />` after `<FeatureSettings />`

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/server/src/server/databases/smsMirror/entity/SmsMessage.ts` | Message entity |
| `packages/server/src/server/databases/smsMirror/entity/SmsChat.ts` | Chat entity |
| `packages/server/src/server/databases/smsMirror/entity/SmsHandle.ts` | Handle entity |
| `packages/server/src/server/databases/smsMirror/entity/SmsAttachment.ts` | Attachment entity |
| `packages/server/src/server/databases/smsMirror/entity/index.ts` | Barrel export |
| `packages/server/src/server/databases/smsMirror/index.ts` | SmsRepository |
| `packages/server/src/server/services/smsMirrorService/index.ts` | SmsMirrorService |
| `packages/ui/src/app/components/fields/SmsMirrorEnabledField.tsx` | Toggle checkbox |
| `packages/ui/src/app/layouts/settings/smsMirror/SmsMirrorSettings.tsx` | Settings section |

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/server/databases/server/constants.ts` | Add `sms_mirror_enabled` default |
| `packages/server/src/server/services/index.ts` | Export SmsMirrorService |
| `packages/server/src/server/index.ts` | Register service (init/start/stop/listeners/config-update) |
| `packages/ui/src/app/layouts/settings/SettingsLayout.tsx` | Add SmsMirrorSettings section |

## Existing Code to Reuse

- `ServerRepository` pattern → `packages/server/src/server/databases/server/index.ts`
- `BooleanTransformer` → `packages/server/src/server/databases/transformers/BooleanTransformer.ts`
- `Loggable` → `packages/server/src/server/lib/logging/Loggable.ts`
- `IMessageListener` event interface → `packages/server/src/server/databases/imessage/listeners/IMessageListener.ts`
- UI patterns: `SlackAlertsEnabledField.tsx` (checkbox), `SlackAlertSettings.tsx` (simple section)

## Verification

1. **Build check:** `npx tsc --noEmit` in both `packages/server` and `packages/ui`
2. **DB creation:** Enable toggle → restart → verify `sms-mirror.db` file created in userData
3. **Write test:** Send an SMS from the iPhone → check logs for SmsMirrorService write → verify row in `sms_message` table (use `sqlite3 sms-mirror.db "SELECT * FROM sms_message"`)
4. **iMessage skip:** Send an iMessage → verify SmsMirrorService does NOT write it
5. **Update test:** Send SMS, wait for delivery → verify `dateDelivered` updated in mirror
6. **Toggle off:** Disable toggle → verify service stops (check logs), no more writes
7. **No impact:** Verify existing WebSocket/FCM message flow unaffected (messages still arrive on connected clients)
