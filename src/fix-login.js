"use strict";

const config = require("./config");
const bcrypt = require("bcryptjs");

(async () => {
  await config.init();
  const getDb = require("./db");
  const db = getDb();

  console.log("🔍 === DIAGNOSTIC LOGIN ===");

  // 1. Cek semua user yang ada
  const semuaUser = await db.all("users");
  console.log(`\n📊 Total user di database: ${semuaUser.length}`);
  semuaUser.forEach((u) => {
    console.log(
      `   - ${u.email} (${u.role}) - Hash: ${u.password_hash?.substring(0, 20)}...`,
    );
  });

  // 2. Coba cari user owner
  const emailTarget = "owner@pasarmini.id";
  const userOwner = await db.find("users", {
    email: emailTarget.toLowerCase(),
  });

  if (!userOwner) {
    console.log(`\n❌ User ${emailTarget} TIDAK DITEMUKAN!`);
    console.log("🔧 Membuat ulang user owner...");

    const passwordHash = await bcrypt.hash("Owner#2026", 10);
    const newUser = await db.insert("users", {
      name: "Pemilik Pasar Mini",
      email: emailTarget.toLowerCase(),
      password_hash: passwordHash,
      role: "owner",
      active: true,
    });
    console.log("✅ User owner berhasil dibuat ulang:", newUser.email);
  } else {
    console.log(`\n✅ User ${emailTarget} ditemukan`);

    // 3. Verifikasi password
    const passwordTest = "Owner#2026";
    const cocok = await bcrypt.compare(passwordTest, userOwner.password_hash);

    if (cocok) {
      console.log("✅ Password hash VALID - Login seharusnya berhasil");
    } else {
      console.log("❌ Password hash TIDAK COCOK!");
      console.log("🔧 Memperbaiki password hash...");

      const hashBaru = await bcrypt.hash(passwordTest, 10);
      await db.update(
        "users",
        { id: userOwner.id },
        { password_hash: hashBaru },
      );
      console.log("✅ Password hash diperbaiki");
    }
  }

  // 4. Test login manual
  console.log("\n === TEST LOGIN MANUAL ===");
  const userFinal = await db.find("users", {
    email: emailTarget.toLowerCase(),
  });
  if (userFinal) {
    const testLogin = await bcrypt.compare(
      "Owner#2026",
      userFinal.password_hash,
    );
    console.log(
      `Test bcrypt.compare('Owner#2026', hash): ${testLogin ? "✅ SUKSES" : "❌ GAGAL"}`,
    );
  }

  console.log("\n✨ Selesai! Silakan coba login di browser.");
  process.exit(0);
})().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
