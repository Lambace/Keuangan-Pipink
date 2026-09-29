"use strict";

const express = require("express");
const { z } = require("zod"); // Import Zod untuk validasi data yang ketat
const dapatkanDb = require("../db");
const otentikasi = require("../middleware/auth");
const akuntansi = require("../services/accounting");

const router = express.Router();

// Semua rute di dalam file ini memerlukan autentikasi pengguna
router.use(otentikasi.requireAuth);

// ==========================================
// SKEMA VALIDASI ZOD
// ==========================================
const skemaTransaksiKeuangan = z.object({
  tanggal: z
    .string()
    .optional()
    .default(() => new Date().toISOString().slice(0, 10)),
  kategori: z.string().min(1, "Kategori wajib diisi"),
  jumlah_nominal: z
    .number({ invalid_type_error: "Jumlah harus berupa angka" })
    .positive("Jumlah nominal harus lebih dari 0"),
  metode_pembayaran: z.enum(["cash", "transfer", "lainnya"]).default("cash"),
  keterangan: z.string().optional().nullable(),
});

// ==========================================
// RUTE-RUTE KEUANGAN
// ==========================================

// 1. Dapatkan daftar saldo semua akun
router.get("/akun", async (permintaan, respons, berikutnya) => {
  try {
    const db = dapatkanDb();
    const daftarSaldo = await akuntansi.hitungSaldo(db);
    respons.json(daftarSaldo);
  } catch (kesalahan) {
    berikutnya(kesalahan);
  }
});

// 2. Dapatkan riwayat jurnal umum (dengan filter tanggal opsional)
router.get("/jurnal", async (permintaan, respons, berikutnya) => {
  try {
    const db = dapatkanDb();
    let daftarEntri = await db.all("entri_jurnal", { orderBy: { id: "desc" } });

    // Filter berdasarkan rentang tanggal jika parameter diberikan
    if (permintaan.query.dari) {
      daftarEntri = daftarEntri.filter(
        (entri) => String(entri.tanggal) >= permintaan.query.dari,
      );
    }
    if (permintaan.query.sampai) {
      daftarEntri = daftarEntri.filter(
        (entri) => String(entri.tanggal) <= permintaan.query.sampai,
      );
    }

    // Ambil detail baris jurnal (debit/kredit) untuk setiap entri
    for (const entri of daftarEntri) {
      entri.baris_jurnal = await db.all("buku_besar", { id_entri: entri.id });
    }

    respons.json(daftarEntri.slice(0, 500)); // Batasi 500 entri terbaru agar performa tetap ringan
  } catch (kesalahan) {
    berikutnya(kesalahan);
  }
});

// 3. Catat Pengeluaran (Beban)
router.post("/pengeluaran", async (permintaan, respons, berikutnya) => {
  try {
    // a. Validasi input menggunakan Zod (akan otomatis menolak jika data tidak sesuai)
    const dataTervalidasi = skemaTransaksiKeuangan.parse(permintaan.body);
    const db = dapatkanDb();

    // b. Gunakan transaksi database (rollback otomatis jika ada error di tengah jalan)
    return db.tx(async (transaksiDb) => {
      // Simpan data mentah pengeluaran ke tabel
      const catatanPengeluaran = await transaksiDb.insert("pengeluaran", {
        tanggal: dataTervalidasi.tanggal,
        kategori: dataTervalidasi.kategori,
        jumlah_nominal: dataTervalidasi.jumlah_nominal,
        metode_pembayaran: dataTervalidasi.metode_pembayaran,
        keterangan: dataTervalidasi.keterangan || null,
        dibuat_oleh: permintaan.user.id,
      });

      // c. Catat ke sistem pembukuan berpasangan (Double-Entry Bookkeeping)
      await akuntansi.catatJurnal(transaksiDb, {
        tanggal: catatanPengeluaran.tanggal,
        jenis_referensi: "pengeluaran",
        id_referensi: catatanPengeluaran.id,
        keterangan: `Beban Operasional: ${dataTervalidasi.kategori}`,
        id_pengguna: permintaan.user.id,
        baris_jurnal: [
          // Debit: Menambah beban
          {
            akun: "Beban Operasional",
            debit: dataTervalidasi.jumlah_nominal,
            kredit: 0,
          },
          // Kredit: Mengurangi aset (Kas atau Bank)
          {
            akun:
              dataTervalidasi.metode_pembayaran === "transfer" ? "Bank" : "Kas",
            debit: 0,
            kredit: dataTervalidasi.jumlah_nominal,
          },
        ],
      });

      respons.status(201).json(catatanPengeluaran);
    });
  } catch (kesalahan) {
    // Tangani error validasi Zod secara khusus agar respons API rapi
    if (kesalahan instanceof z.ZodError) {
      return respons
        .status(400)
        .json({ error: "Validasi data gagal", detail: kesalahan.errors });
    }
    berikutnya(kesalahan);
  }
});

// 4. Catat Pemasukan (Pendapatan Lain)
router.post("/pemasukan", async (permintaan, respons, berikutnya) => {
  try {
    const dataTervalidasi = skemaTransaksiKeuangan.parse(permintaan.body);
    const db = dapatkanDb();

    return db.tx(async (transaksiDb) => {
      const catatanPemasukan = await transaksiDb.insert("pemasukan", {
        tanggal: dataTervalidasi.tanggal,
        kategori: dataTervalidasi.kategori,
        jumlah_nominal: dataTervalidasi.jumlah_nominal,
        metode_pembayaran: dataTervalidasi.metode_pembayaran,
        keterangan: dataTervalidasi.keterangan || null,
        dibuat_oleh: permintaan.user.id,
      });

      await akuntansi.catatJurnal(transaksiDb, {
        tanggal: catatanPemasukan.tanggal,
        jenis_referensi: "pemasukan",
        id_referensi: catatanPemasukan.id,
        keterangan: `Pendapatan Lain: ${dataTervalidasi.kategori}`,
        id_pengguna: permintaan.user.id,
        baris_jurnal: [
          // Debit: Menambah aset (Kas atau Bank)
          {
            akun:
              dataTervalidasi.metode_pembayaran === "transfer" ? "Bank" : "Kas",
            debit: dataTervalidasi.jumlah_nominal,
            kredit: 0,
          },
          // Kredit: Menambah pendapatan
          {
            akun: "Pendapatan Lain",
            debit: 0,
            kredit: dataTervalidasi.jumlah_nominal,
          },
        ],
      });

      respons.status(201).json(catatanPemasukan);
    });
  } catch (kesalahan) {
    if (kesalahan instanceof z.ZodError) {
      return respons
        .status(400)
        .json({ error: "Validasi data gagal", detail: kesalahan.errors });
    }
    berikutnya(kesalahan);
  }
});

// 5. Dapatkan riwayat pengeluaran
router.get("/pengeluaran", async (permintaan, respons, berikutnya) => {
  try {
    const db = dapatkanDb();
    respons.json(await db.all("pengeluaran", { orderBy: { id: "desc" } }));
  } catch (kesalahan) {
    berikutnya(kesalahan);
  }
});

// 6. Dapatkan riwayat pemasukan
router.get("/pemasukan", async (permintaan, respons, berikutnya) => {
  try {
    const db = dapatkanDb();
    respons.json(await db.all("pemasukan", { orderBy: { id: "desc" } }));
  } catch (kesalahan) {
    berikutnya(kesalahan);
  }
});

module.exports = router;
