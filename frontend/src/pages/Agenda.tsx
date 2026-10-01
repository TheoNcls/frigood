import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useActivities, useActivityTypes, useIngredients, useMealLogs, useRecipes, useTasks } from "../api/queries";
import type { Activity, TaskOccurrence } from "../api/types";
import ActivityDetail from "../components/ActivityDetail";
import DaySummary from "../components/DaySummary";
import { useInvalidateSport } from "../components/Garmin";
import AddEntryModal from "../components/AddEntry";
import { IMPORTANT_COLOR, TASK_COLOR, TaskForm } from "../components/Tasks";
import { useToast } from "../components/Toast";
import { Card, Empty, PageHeader } from "../components/ui";
import { addDays, formatFull, toISODate, todayISO } from "../lib/dates";
import { activityDetails, activityLabel } from "../lib/activity";
import { fmt, logMacros } from "../lib/nutrition";

export default function Agenda() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {adding && <AddEntryModal date={todayISO()} onClose={() => setAdding(false)} />}
      <PageHeader
        title="Agenda"
        subtitle="Tâches, sport et repas au fil des jours"
        action={<button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Ajouter</button>}
      />
      <AgendaCalendar />
      <RecentActivities />
    </div>
  );
}


const SPORT_COLOR = "#ea580c";

function AgendaCalendar() {
  const today = todayISO();
  const [range, setRange] = useState({ from: addDays(today, -40), to: addDays(today, 40) });
  const types = useActivityTypes();
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const acts = useActivities({ date_from: range.from, date_to: range.to });
  const meals = useMealLogs({ date_from: range.from, date_to: range.to });
  const tasks = useTasks(range.from, range.to);

  const events = useMemo<EventInput[]>(() => {
    const out: EventInput[] = (acts.data ?? []).map((a) => {
      const details = activityDetails(a, { hr: false });
      return {
        id: `a${a.id}`,
        title: [activityLabel(a, types.byId), details].filter(Boolean).join(" · "),
        start: a.date,
        allDay: true,
        color: SPORT_COLOR,
      };
    });
    const byDate = new Map<string, { count: number; cal: number }>();
    for (const log of meals.data ?? []) {
      const d = byDate.get(log.date) ?? { count: 0, cal: 0 };
      d.count++;
      d.cal += logMacros(log, ingredients.byId, recipes.byId).cal;
      byDate.set(log.date, d);
    }
    for (const [date, d] of byDate) {
      out.push({ id: `m${date}`, title: `🍽 ${d.count} repas · ${fmt(d.cal)} kcal`, start: date, allDay: true, color: "#059669" });
    }
    for (const t of tasks.data ?? []) {
      out.push({
        id: `t${t.task_id}_${t.date}`,
        title: `${t.statut === "fait" ? "✓" : t.statut === "pas_fait" ? "✗" : "☐"} ${t.important ? "⭐ " : ""}${t.titre}`,
        // Avec une heure : événement horaire (heure affichée par le calendrier, tri chronologique)
        start: t.heure ? `${t.date}T${t.heure}` : t.date,
        allDay: !t.heure,
        color: t.important ? IMPORTANT_COLOR : TASK_COLOR,
        textColor: "#fff",
        classNames: t.statut === "fait" ? ["fc-task-done"] : t.statut === "pas_fait" ? ["fc-task-done", "fc-task-missed"] : [],
        // Importante encore à faire : en tête du jour, jamais cachée dans « +N en plus »
        extendedProps: { rank: t.important && !t.statut ? 0 : 1 },
      });
    }
    // Rang par défaut (repas, sport, tâches normales) : les importantes à faire passent devant
    return out.map((e) => ({ ...e, extendedProps: { rank: 1, ...e.extendedProps } }));
  }, [acts.data, meals.data, tasks.data, types.byId, ingredients.byId, recipes.byId]);

  const [openedDay, setOpenedDay] = useState<string | null>(null);
  const openDay = (iso: string) => setOpenedDay(iso);
  const [openedActivity, setOpenedActivity] = useState<Activity | null>(null);
  const [openedTask, setOpenedTask] = useState<TaskOccurrence | null>(null);

  // Activité : fiche détaillée ; tâche : modification ; repas : résumé du jour
  function onEventClick(arg: EventClickArg) {
    const id = arg.event.id;
    if (id.startsWith("t")) {
      const [taskId, date] = id.slice(1).split("_");
      const task = (tasks.data ?? []).find((t) => t.task_id === Number(taskId) && t.date === date);
      if (task) return setOpenedTask(task);
    }
    if (id.startsWith("a")) {
      const activity = (acts.data ?? []).find((a) => a.id === Number(id.slice(1)));
      if (activity) return setOpenedActivity(activity);
    }
    if (arg.event.start) openDay(toISODate(arg.event.start));
  }

  function onDatesSet(arg: DatesSetArg) {
    const from = toISODate(arg.start);
    const to = toISODate(addDaysDate(arg.end, -1));
    if (from !== range.from || to !== range.to) setRange({ from, to });
  }

  return (
    <Card title="Calendrier">
      {openedActivity && <ActivityDetail activity={openedActivity} onClose={() => setOpenedActivity(null)} />}
      {openedTask && <TaskForm task={openedTask} onClose={() => setOpenedTask(null)} />}
      {openedDay && <DaySummary date={openedDay} onClose={() => setOpenedDay(null)} />}
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="text-slate-500">Clique sur un événement pour son détail, sur un jour pour son résumé ou ajouter une activité / une tâche ·</span>
        <Legend color="#059669" label="Repas" />
        <Legend color={SPORT_COLOR} label="Sport" />
        <Legend color={TASK_COLOR} label="Tâche" />
        <Legend color={IMPORTANT_COLOR} label="Importante" />
      </div>
      <FullCalendar
        plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
        dateClick={(arg: DateClickArg) => openDay(toISODate(arg.date))}
        eventClick={onEventClick}
        dayCellClassNames="fc-day-clickable"
        locale={frLocale}
        initialView={window.innerWidth < 640 ? "listWeek" : "dayGridMonth"}
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,listWeek" }}
        events={events}
        datesSet={onDatesSet}
        height="auto"
        eventDisplay="block"
        dayMaxEvents={3}
        eventOrder="rank,start,-duration,allDay,title"
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit" }}
      />
    </Card>
  );
}

function addDaysDate(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function RecentActivities() {
  const today = todayISO();
  const acts = useActivities({ date_from: addDays(today, -60), date_to: today });
  const types = useActivityTypes();
  const toast = useToast();
  const invalidate = useInvalidateSport();

  const remove = useMutation({
    mutationFn: (id: number) => api(`/activities/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });

  const list = (acts.data ?? []).slice(0, 10);
  const [opened, setOpened] = useState<Activity | null>(null);

  return (
    <Card title="Activités récentes">
      {opened && <ActivityDetail activity={opened} onClose={() => setOpened(null)} />}
      {!list.length ? <Empty>Aucune activité sur les 60 derniers jours.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {list.map((a) => {
            const label = activityLabel(a, types.byId);
            return (
              <li key={a.id} className="flex items-center gap-3 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-slate-50"
                  onClick={() => setOpened(a)}
                >
                  <span className="w-24 shrink-0 text-sm text-slate-500">{formatFull(a.date)}</span>
                  <span title={a.source === "garmin" ? "Garmin" : "Manuel"}>{a.source === "garmin" ? "⌚" : "✏️"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{label}</div>
                    <div className="truncate text-xs text-slate-500">
                      {activityDetails(a) || "—"}
                      {a.notes && a.notes !== label ? ` · ${a.notes}` : ""}
                    </div>
                  </div>
                </button>
                <button className="btn-ghost" aria-label="Supprimer" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
