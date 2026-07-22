// ═══════════════════════════════════════════════════════════
// إنشاء مستخدم أدمن للوحة التحكم
// الاستخدام:  node scripts/create-admin.js <username> <password>
// ═══════════════════════════════════════════════════════════
import bcrypt from "bcryptjs";
import { getUser, createUser } from "../src/db/database.js";

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("❌ الاستخدام: node scripts/create-admin.js <username> <password>");
  process.exit(1);
}

if (getUser(username)) {
  console.error(`⚠️  المستخدم "${username}" موجود مسبقاً.`);
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
createUser(username, hash);
console.log(`✅ تم إنشاء المستخدم "${username}" بنجاح. تقدر تسجّل دخول على /admin/login`);
process.exit(0);
