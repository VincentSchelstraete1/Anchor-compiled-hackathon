import type { Event, Memory, Person } from "@/lib/api/types";

const DEMO_PREFIX = "Fictional demo —";

export const isDemoPerson = (person: Person) => person.description.startsWith(DEMO_PREFIX);
export const isDemoProfile = (person: Person) => isDemoPerson(person) && person.relationship === "Self";
export const isDemoMemory = (memory: Memory) => memory.category.startsWith("Demo ·");
export const isDemoEvent = (event: Event) => event.description.startsWith(DEMO_PREFIX);
