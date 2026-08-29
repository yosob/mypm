import * as db from "../src/db";
console.log("fields:", JSON.stringify(db.listFields()));
const t5 = db.getTask(5);
console.log("task5 custom:", t5 ? JSON.stringify(db.getCustom(t5)) : "task5不存在");
console.log("task5 resources:", JSON.stringify(db.listTaskResources(5)));
process.exit(0);
