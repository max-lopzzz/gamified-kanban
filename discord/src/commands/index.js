import questboard from "./link.js";
import tasks from "./tasks.js";
import mine from "./mine.js";
import standup from "./standup.js";
import sprint from "./sprint.js";

export const commands = [questboard, tasks, mine, standup, sprint];
export const byName = new Map(commands.map((c) => [c.name, c]));
