# Vision / Image Input — AI Command Centre

**Feature:** Allow users to attach images (screenshots, scanned docs, photos of whiteboards/slides) directly in the AI chat. Claude reads the image, extracts requirements or data, then searches the KB and responds — all in a single agentic loop.

**Status:** Not built. Spec complete.  
**Priority:** High — RFI content frequently arrives as screenshots of spreadsheets, scanned requirement tables, or image exports that can't be indexed as documents.

---

## Problem

The current pipeline only accepts `.pdf`, `.docx`, `.xlsx` attachments. These are uploaded to Supabase storage, chunked, embedded, and searched via the RAG pipeline. Images are completely unsupported.

In practice, pre-sales regularly receives:
- Screenshots of requirement grids from client portals (SAP Ariba, Jaggaer, etc.)
- Scanned RFI PDFs where the underlying text layer is absent or garbled
- WhatsApp/email forwarded images of questionnaires
- Photos of whiteboard sessions from client discovery calls

Today these have to be manually retyped. Vision input eliminates that entirely.

---

## How It Works (End-to-End)

Images bypass the upload→chunk→embed pipeline entirely. They are base64-encoded client-side and passed inline as a `content` block in the user message to the Anthropic API. Claude reads the image natively, extracts the content, then calls `search_knowledge_base` as normal to ground its answer in the KB.

```
User attaches image
  → client base64-encodes it (no upload to Supabase storage)
  → user message content becomes an array: [{ type: "image", ... }, { type: "text", ... }]
  → server receives image block + text → passes to Claude as-is
  → Claude reads image, understands requirements/questions
  → calls search_knowledge_base for each extracted topic
  → returns KB-grounded answer
```

No OCR step. No separate extraction step. Claude handles the full read-and-respond cycle.

---

## Scope

### In scope
- PNG, JPEG, WEBP, GIF attachments in the AI chat input (not docs page)
- Single or multiple images per message (up to 5)
- Max 5 MB per image (Anthropic API hard limit: 20 MB per image, but we cap lower for UX)
- Works in both bid-scoped and global AI sessions
- Image shown as thumbnail chip in the user message bubble
- Images are NOT uploaded to Supabase storage (ephemeral, in-message only)
- Images are NOT stored in `messages jsonb` in the DB (too large — store a placeholder)
- Works on all Claude models that support vision (Opus 4.8, Sonnet 4.6) — Haiku 4.5 also supports vision

### Out of scope
- Image persistence across sessions (by design — images are turn-scoped)
- Image search/retrieval via the RAG pipeline (would require CLIP or multimodal embeddings)
- Video or audio input
- Azure model support (GPT-5.4 / OSS-120B — handle separately if needed)

---

## Implementation Plan

### Phase 1 — Data model & transport (server)

**File: `src/lib/api/stream-chat.ts`**

Extend `InputSchema` to accept image blocks alongside text:

```ts
// New image block type
const ImageBlockSchema = z.object({
  type: z.literal("image"),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: z.string(), // base64, no data-URI prefix
});

// Message content can now be a string (text-only) or an array of blocks
const MessageContentSchema = z.union([
  z.string(),
  z.array(z.union([
    z.object({ type: z.literal("text"), text: z.string() }),
    ImageBlockSchema,
  ])),
]);

// Update message shape
messages: z.array(
  z.object({
    role: z.enum(["user", "assistant"]),
    content: MessageContentSchema,
    created_at: z.string(),
  })
),
```

Update `runAnthropicLoop` to map the new content shape to Anthropic's API format:

```ts
const messages: AnthropicMsg[] = history.map((m) => ({
  role: m.role,
  content: typeof m.content === "string"
    ? m.content
    : m.content.map((block) =>
        block.type === "image"
          ? {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: block.mediaType,
                data: block.data,
              },
            }
          : { type: "text" as const, text: block.text }
      ),
}));
```

> Azure loop (`runAzureLoop`): OpenAI-compatible vision uses the same `content` array format but with `image_url` blocks. Add a separate mapper for Azure if/when needed — skip for now, default to text-only for Azure models when images are present.

---

### Phase 2 — Client state & send path

**File: `src/lib/ai-queries.ts`**

Extend `Message` type:

```ts
export type ImageBlock = {
  type: "image";
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string; // base64
  name: string; // display only
};

export type Message = {
  role: "user" | "assistant";
  // content is string for assistant messages; string or block array for user messages
  content: string | Array<{ type: "text"; text: string } | ImageBlock>;
  created_at: string;
  exportMeta?: { format: string; filename: string };
  attachments?: string[];     // doc filenames (existing)
  imageAttachments?: string[]; // image filenames — stored in DB instead of base64
};
```

**DB persistence strategy:** The `messages` jsonb column stores the full message history. Storing raw base64 images would bloat it significantly (a 2 MB image = ~2.7 MB base64 per turn). Instead:

- Before saving to DB: strip `data` from image blocks, replace with `{ type: "image", name, mediaType, data: "[omitted]" }`
- In-memory (React state): keep full base64 for the current session so the thumbnail renders
- On session reload: image thumbnails won't re-render (show a placeholder chip "Image — not persisted")

This keeps the DB lean. Images are ephemeral by design.

Extend `send()` signature:

```ts
send(
  overrideText?: string,
  mentionedDocIds?: string[],
  attachmentNames?: string[],
  imageBlocks?: ImageBlock[],   // new
)
```

Build user message content:

```ts
const hasImages = imageBlocks?.length;
const userMsg: Message = {
  role: "user",
  content: hasImages
    ? [
        ...imageBlocks.map((b) => ({ type: "image" as const, mediaType: b.mediaType, data: b.data, name: b.name })),
        ...(text ? [{ type: "text" as const, text }] : []),
      ]
    : text,
  created_at: new Date().toISOString(),
};
```

Pass to server — images go in the message content, not as a separate field:

```ts
const stream = await streamChat({
  sessionId,
  bidId,
  messages: updatedWithUser,
  model,
  mentionedDocIds: ...,
});
```

No new `streamChat` API surface needed — images ride inside `messages[].content`.

---

### Phase 3 — UI: image picker + thumbnail chips

**File: `src/components/ai/AiChatPanel.tsx`**

Add a second hidden file input for images (separate from the doc paperclip input):

```tsx
const imageInputRef = useRef<HTMLInputElement>(null);
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const MAX_IMAGE_BYTES = 5_242_880; // 5 MB
const MAX_IMAGES = 5;

type ImageAttachment = {
  localId: string;
  name: string;
  mediaType: string;
  data: string;      // base64
  previewUrl: string; // object URL for thumbnail
};
const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
```

Base64-encode on select (no upload, fully client-side):

```ts
async function handleImagesSelected(files: FileList | null) {
  if (!files) return;
  const valid = Array.from(files).filter(
    (f) => IMAGE_EXT.test(f.name) && f.size <= MAX_IMAGE_BYTES
  );
  if (imageAttachments.length + valid.length > MAX_IMAGES) {
    toast.warning(`Max ${MAX_IMAGES} images per message`);
    return;
  }
  for (const file of valid) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target?.result as string;
      const data = dataUri.split(",")[1]; // strip "data:image/...;base64,"
      const previewUrl = URL.createObjectURL(file);
      setImageAttachments((prev) => [
        ...prev,
        {
          localId: crypto.randomUUID(),
          name: file.name,
          mediaType: file.type,
          data,
          previewUrl,
        },
      ]);
    };
    reader.readAsDataURL(file);
  }
}
```

Add an image icon button next to the paperclip (or combine into the same picker). Show thumbnail chips in the input bar:

```tsx
{imageAttachments.map((img) => (
  <div key={img.localId} className="relative shrink-0">
    <img
      src={img.previewUrl}
      alt={img.name}
      className="h-12 w-12 rounded-md object-cover border hairline border-border"
    />
    <button
      onClick={() => {
        URL.revokeObjectURL(img.previewUrl);
        setImageAttachments((prev) => prev.filter((i) => i.localId !== img.localId));
      }}
      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center text-[8px]"
    >
      ×
    </button>
  </div>
))}
```

Gate image attach by model capability:

```ts
const modelSupportsVision = !model.startsWith("azure-"); // Haiku/Sonnet/Opus all support vision
const canAttachImage = modelSupportsVision; // available in both global and bid modes
```

Show inline thumbnails in the user message bubble:

```tsx
{/* In MessageBubble, above the text content */}
{isUser && Array.isArray(message.content) && message.content
  .filter((b) => b.type === "image")
  .map((b, i) => (
    b.data !== "[omitted]"
      ? <img key={i} src={`data:${b.mediaType};base64,${b.data}`} className="max-h-48 rounded-lg mb-2" />
      : <div key={i} className="text-[10px] text-muted-foreground mb-1">📷 {b.name} (image not persisted)</div>
  ))
}
```

---

### Phase 4 — System prompt hint

Add one line to the system prompt blocks so the model knows what to do when it sees an image:

**File: `src/lib/api/stream-chat.ts`** — append to `RFI_RFP_PERSONA`:

```
IMAGE INPUT
When the user attaches an image: (1) extract all visible text, tables, and requirements from it; (2) treat extracted content as client requirements; (3) search the KB for each extracted topic using search_knowledge_base; (4) respond with KB-grounded answers. Never say you "cannot read" an image.
```

---

## File Change Summary

| File | Change |
|------|--------|
| `src/lib/api/stream-chat.ts` | Extend `InputSchema` message content type; update `runAnthropicLoop` message mapper; add image hint to system prompt |
| `src/lib/ai-queries.ts` | Extend `Message` type with `ImageBlock`; extend `send()` signature; handle base64 stripping before DB persist |
| `src/components/ai/AiChatPanel.tsx` | Add image file input + picker button; base64 encode on select; thumbnail chips in input bar; inline thumbnails in message bubbles; gate by model |

No DB migrations needed. No new server functions. No storage changes.

---

## Edge Cases & Constraints

| Concern | Handling |
|---------|----------|
| Image too large | Client-side check at 5 MB — reject before encoding |
| >5 images per message | Cap enforced client-side — toast warning |
| Azure models (GPT-5.4, OSS-120B) | Strip images before sending; show warning "Vision not supported for this model" |
| Haiku selected | Vision supported — no special handling |
| Session reload — images gone | Show `📷 filename (image not persisted)` placeholder chip |
| History window (30 messages) | Image blocks in older messages get sliced out normally — no special handling |
| Context window cost | A 2 MB image ≈ 1,000–2,500 tokens (Anthropic pricing). At 5 images per message, max ~12,500 tokens per turn — well within the 200K window |
| CLEAR sentinel + image round | If model narrates before tool_use, CLEAR resets `assistantContent` only — image blocks in user message are unaffected |

---

## Estimated Effort

| Phase | Work |
|-------|------|
| Phase 1 — Schema + server loop | 2–3 hours |
| Phase 2 — Client state + send path | 2–3 hours |
| Phase 3 — UI (picker, chips, bubbles) | 3–4 hours |
| Phase 4 — System prompt | 15 minutes |
| **Total** | **~1 day** |

No external dependencies to add — the Anthropic SDK already supports vision. No new API keys. No migrations.
