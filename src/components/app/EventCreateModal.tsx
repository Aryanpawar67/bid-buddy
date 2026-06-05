import { useState } from "react";
import { useCreateEvent } from "@/lib/calendar-queries";

type Props = {
  initialDate: Date;
  onClose: () => void;
};

export function EventCreateModal({ initialDate, onClose }: Props) {
  const createEvent = useCreateEvent();
  const [title, setTitle] = useState("");

  const pad = (n: number) => String(n).padStart(2, "0");
  const localIso = `${initialDate.getFullYear()}-${pad(initialDate.getMonth() + 1)}-${pad(initialDate.getDate())}T${pad(initialDate.getHours())}:${pad(initialDate.getMinutes())}`;
  const [dateTime, setDateTime] = useState(localIso);

  function handleSave() {
    if (!title.trim()) return;
    createEvent.mutate(
      { title: title.trim(), event_date: new Date(dateTime).toISOString() },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div className="bg-card border hairline border-border rounded-xl shadow-lg w-[340px] p-5">
        <div className="text-[13px] font-semibold mb-4">New Event</div>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Event title"
              className="w-full h-8 px-3 text-[12px] rounded-md border hairline border-border-strong bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Date & Time</label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="w-full h-8 px-3 text-[12px] rounded-md border hairline border-border-strong bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded-md border hairline border-border-strong text-[12px] text-muted-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || createEvent.isPending}
            className="h-8 px-4 rounded-md bg-primary text-white text-[12px] font-medium disabled:opacity-50 hover:opacity-90"
          >
            {createEvent.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
