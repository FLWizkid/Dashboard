/**
 * Empty demo seed.
 *
 * Initialises the in-memory stores with no data so every screen starts
 * clean. The plumbing (memory repositories, ensure guard) stays in place
 * for the end-to-end test suite, which loads its own fixtures.
 */
export async function seedDemoWeek(): Promise<void> {
  const [
    tasksStore,
    notesStore,
    hoursStore,
    reportsStore,
    priorityStore,
    mailStore,
  ] = await Promise.all([
    import("@/lib/tasks/repository.memory"),
    import("@/lib/notes/repository.memory"),
    import("@/lib/hours/repository.memory"),
    import("@/lib/reports/repository.memory"),
    import("@/lib/priority/repository.memory"),
    import("@/lib/mail/repository.memory"),
  ]);

  tasksStore.seedMemoryTasks([]);
  notesStore.seedMemoryNotes([]);
  hoursStore.seedMemoryHours({ sessions: [], entries: [], rules: [] });
  hoursStore.seedMemoryEvents([]);
  reportsStore.seedMemoryInbox([]);
  mailStore.seedMemoryMail({ messages: [], senders: [], events: [] });
  priorityStore.seedPriorityEvents([]);
}
