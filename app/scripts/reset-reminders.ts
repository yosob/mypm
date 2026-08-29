import * as db from "../src/db";
db.db.exec("DELETE FROM reminders");
console.log("reminders cleared");
process.exit(0);
