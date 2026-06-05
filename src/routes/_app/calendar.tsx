import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { Calendar, dateFnsLocalizer, type SlotInfo } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";
import {
  useCalendarBids,
  useCalendarEvents,
  useDeleteEvent,
  type ViewMode,
} from "@/lib/calendar-queries";
import { EventCreateModal } from "@/components/app/EventCreateModal";

export const Route = createFileRoute("/_app/calendar")({
  component: CalendarPage,
});

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
});

type ResourceDeadline = { type: "deadline"; bidId: string };
type ResourceEvent = { type: "event"; eventId: string };
type CalendarEntry = {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: ResourceDeadline | ResourceEvent;
};

function CalendarPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(new Date());
  const [mode, setMode] = useState<ViewMode>("team");
  const [createSlot, setCreateSlot] = useState<Date | null>(null);
  const [popover, setPopover] = useState<{
    event: CalendarEntry;
    x: number;
    y: number;
  } | null>(null);

  const deleteEvent = useDeleteEvent();
  const bids = useCalendarBids(mode);
  const { data: events = [] } = useCalendarEvents(mode);

  const deadlineEntries: CalendarEntry[] = bids.map((b) => ({
    title: b.client_name,
    start: new Date(b.deadline),
    end: new Date(b.deadline),
    allDay: true,
    resource: { type: "deadline" as const, bidId: b.id },
  }));

  const eventEntries: CalendarEntry[] = events.map((e) => ({
    title: e.title,
    start: new Date(e.event_date),
    end: new Date(new Date(e.event_date).getTime() + 60 * 60 * 1000),
    allDay: false,
    resource: { type: "event" as const, eventId: e.id },
  }));

  const allEntries = [...deadlineEntries, ...eventEntries];

  const handleSelectSlot = useCallback((slot: SlotInfo) => {
    setPopover(null);
    setCreateSlot(slot.start as Date);
  }, []);

  const handleSelectEvent = useCallback(
    (entry: CalendarEntry, e: React.SyntheticEvent) => {
      if (entry.resource.type === "deadline") {
        navigate({ to: "/bids/$id", params: { id: entry.resource.bidId } });
        return;
      }
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setPopover({ event: entry, x: rect.left, y: rect.bottom + 6 });
    },
    [navigate],
  );

  function eventStyleGetter(entry: CalendarEntry) {
    const isDeadline = entry.resource.type === "deadline";
    return {
      style: {
        backgroundColor: isDeadline ? "var(--primary)" : "var(--accent)",
        border: "none",
        borderRadius: "4px",
        color: "white",
        fontSize: "11px",
        padding: "1px 6px",
        cursor: "pointer",
      },
    };
  }

  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - date.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekLabel =
    format(weekStart, "MMM d") + " – " + format(weekEnd, "MMM d, yyyy");

  const prevWeek = () => setDate((d) => new Date(d.getTime() - 7 * 86400000));
  const nextWeek = () => setDate((d) => new Date(d.getTime() + 7 * 86400000));
  const goToday = () => setDate(new Date());

  return (
    <div className="h-full flex flex-col" onClick={() => setPopover(null)}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b hairline border-border bg-card shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={prevWeek}
            className="size-7 rounded flex items-center justify-center text-muted-foreground hover:bg-background border hairline border-border-strong"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2} />
          </button>
          <button
            onClick={goToday}
            className="h-7 px-3 text-[11px] rounded border hairline border-border-strong text-muted-foreground hover:bg-background"
          >
            Today
          </button>
          <button
            onClick={nextWeek}
            className="size-7 rounded flex items-center justify-center text-muted-foreground hover:bg-background border hairline border-border-strong"
          >
            <ChevronRight className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        <span className="text-[13px] font-medium">{weekLabel}</span>
        <div className="flex-1" />
        <div className="flex rounded-md border hairline border-border-strong overflow-hidden">
          {(["team", "personal"] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={(e) => { e.stopPropagation(); setMode(m); }}
              className={[
                "h-7 px-3 text-[11px] capitalize transition-colors",
                mode === m
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:bg-background",
              ].join(" ")}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1 min-h-0 p-4 rbc-wrapper">
        <Calendar
          localizer={localizer}
          events={allEntries as object[]}
          view="week"
          views={["week"]}
          date={date}
          onNavigate={setDate}
          selectable
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent as (event: object, e: React.SyntheticEvent) => void}
          eventPropGetter={eventStyleGetter as (event: object) => object}
          toolbar={false}
          style={{ height: "100%" }}
        />
      </div>

      {/* Create modal */}
      {createSlot && (
        <EventCreateModal
          initialDate={createSlot}
          onClose={() => setCreateSlot(null)}
        />
      )}

      {/* Ad-hoc event popover */}
      {popover && popover.event.resource.type === "event" && (
        <div
          className="fixed z-40 bg-card border hairline border-border shadow-lg rounded-lg p-3 w-[220px]"
          style={{
            left: Math.min(popover.x, window.innerWidth - 240),
            top: popover.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[12px] font-medium mb-1">{popover.event.title}</div>
          <div className="text-[11px] text-muted-foreground mb-3">
            {format(popover.event.start, "EEE MMM d, h:mm a")}
          </div>
          <button
            onClick={() => {
              const res = popover.event.resource as ResourceEvent;
              deleteEvent.mutate(res.eventId);
              setPopover(null);
            }}
            className="text-[11px] text-destructive hover:underline"
          >
            Delete event
          </button>
        </div>
      )}
    </div>
  );
}
