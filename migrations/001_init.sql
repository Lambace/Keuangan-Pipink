'use strict';

const express = require('express');
const { z } = require('zod');
const dapatkanDb = require('../db');
const otentikasi = require('../middleware/auth');
const akuntansi = require('../services/accounting');

const router = express.Router();

// Semua rute di sini memerlukan autentikasi
router.use(otentikasi.requireAuth);

// ==========================================
// 1. SKEMA VALIDASI ZOD (Disesuaikan dengan CHECK constraint di DB)
// ==========================================
const skemaTransaksiKeuangan = z.object({
    tanggal: z.string().optional().default(() => new Date().toISOString().slice(0, 10)),
    kategori: z.string().min(1, 'Kategori wajib diisi'),
    jumlah_nominal: z.number({ invalid_type_error: 'Jumlah harus berupa angka' }).positive('Jumlah nominal harus lebih dari 0'),
    // Disesuaikan dengan: CHECK (payment_method IN ('cash','transfer','qris','credit'))
    metode_pembayaran: z.enum(['cash', 'transfer', 'qris', 'credit']).default('cash'),
    keterangan: z.string().optional().nullable()
});

// ==========================================
// 2. RUTE-RUTE KEUANGAN
// ==========================================

// A. Dapatkan daftar saldo semua akun
router.get('/akun', async (permintaan, respons, berikutnya) => {
    try {
        const db = dapatkanDb();
        // Asumsi fungsi di services/accounting sudah menangani pengambilan saldo
        const daftarSaldo = await akuntansi.hitungSaldo(db); 
        respons.json(daftarSaldo);
    } catch (kesalahan) {
        berikutnya(kesalahan);
    }
});

// B. Dapatkan riwayat jurnal umum
router.get('/jurnal', async (permintaan, respons, berikutnya) => {
    try {
        const db = dapatkanDb();
        let daftarEntri = await db.all('journal_entries', { orderBy: { id: 'desc' } });
        
        if (permintaan.query.dari) {
            daftarEntri = daftarEntri.filter(entri => String(entri.date) >= permintaan.query.dari);
        }
        if (permintaan.query.sampai) {
            daftarEntri = daftarEntri.filter(entri => String(entri.date) <= permintaan.query.sampai);
        }

        // Ambil detail baris jurnal (debit/kredit) untuk setiap entri
        for (const entri of daftarEntri) {
            entri.baris_jurnal = await db.all('ledger', { entry_id: entri.id });
        }

        respons.json(daftarEntri.slice(0, 500));
    } catch (kesalahan) {
        berikutnya(kesalahan);
    }
});

// C. Catat Pengeluaran (Beban)
router.post('/pengeluaran', async (permintaan, respons, berikutnya) => {
    try {
        // 1. Validasi input
        const dataTervalidasi = skemaTransaksiKeuangan.parse(permintaan.body);
        const db = dapatkanDb();

        // 2. Gunakan transaksi database (rollback otomatis jika gagal)
        return db.tx(async (transaksiDb) => {
            // MAPING: Variabel Indonesia -> Kolom Database Inggris
            const catatanPengeluaran = await transaksiDb.insert('expenses', {
                date: dataTervalidasi.tanggal,
                category: dataTervalidasi.kategori,
                amount: dataTervalidasi.jumlah_nominal,
                payment_method: dataTervalidasi.metode_pembayaran,
                description: dataTervalidasi.keterangan || null,
                created_by: permintaan.user.id
            });

            // 3. Catat ke sistem pembukuan berpasangan (Double-Entry)
            // Asumsi: fungsi akuntansi.catatJurnal menerima 'nama_akun' dan akan mencari 'account_id' secara internal
            await akuntansi.catatJurnal(transaksiDb, {
                date: catatanPengeluaran.date,
                refType: 'expense',
                refId: catatanPengeluaran.id,
                description: `Beban Operasional: ${dataTervalidasi.kategori}`,
                userId: permintaan.user.id,
                lines: [
                    // Debit: Menambah beban
                    { nama_akun: 'Beban Operasional', debit: dataTervalidasi.jumlah_nominal, kredit: 0 },
                    // Kredit: Mengurangi aset (Kas atau Bank)
                    { nama_akun: dataTervalidasi.metode_pembayaran === 'transfer' ? 'Bank' : 'Kas', debit: 0, kredit: dataTervalidasi.jumlah_nominal }
                ]
            });

            respons.status(201).json(catatanPengeluaran);
        });
    } catch (kesalahan) {
        if (kesalahan instanceof z.ZodError) {
            return respons.status(400).json({ error: 'Validasi data gagal', detail: kesalahan.errors });
        }
        berikutnya(kesalahan);
    }
});

// D. Catat Pemasukan (Pendapatan Lain)
router.post('/pemasukan', async (permintaan, respons, berikutnya) => {
    try {
        const dataTervalidasi = skemaTransaksiKeuangan.parse(permintaan.body);
        const db = dapatkanDb();

        return db.tx(async (transaksiDb) => {
            const catatanPemasukan = await transaksiDb.insert('incomes', {
                date: dataTervalidasi.tanggal,
                category: dataTervalidasi.kategori,
                amount: dataTervalidasi.jumlah_nominal,
                payment_method: dataTervalidasi.metode_pembayaran,
                description: dataTervalidasi.keterangan || null,
                created_by: permintaan.user.id
            });

            await akuntansi.catatJurnal(transaksiDb, {
                date: catatanPemasukan.date,
                refType: 'income',
                refId: catatanPemasukan.id,
                description: `Pendapatan Lain: ${dataTervalidasi.kategori}`,
                userId: permintaan.user.id,
                lines: [
                    // Debit: Menambah aset (Kas atau Bank)
                    { nama_akun: dataTervalidasi.metode_pembayaran === 'transfer' ? 'Bank' : 'Kas', debit: dataTervalidasi.jumlah_nominal, kredit: 0 },
                    // Kredit: Menambah pendapatan
                    { nama_akun: 'Pendapatan Lain', debit: 0, kredit: dataTervalidasi.jumlah_nominal }
                ]
            });

            respons.status(201).json(catatanPemasukan);
        });
    } catch (kesalahan) {
        if (kesalahan instanceof z.ZodError) {
            return respons.status(400).json({ error: 'Validasi data gagal', detail: kesalahan.errors });
        }
        berikutnya(kesalahan);
    }
});

// E. Dapatkan riwayat pengeluaran
router.get('/pengeluaran', async (permintaan, respons, berikutnya) => {
    try {
        const db = dapatkanDb();
        respons.json(await db.all('expenses', { orderBy: { id: 'desc' } }));
    } catch (kesalahan) {
        berikutnya(kesalahan);
    }
});

// F. Dapatkan riwayat pemasukan
router.get('/pemasukan', async (permintaan, respons, berikutnya) => {
    try {
        const db = dapatkanDb();
        respons.json(await db.all('incomes', { orderBy: { id: 'desc' } }));
    } catch (kesalahan) {
        berikutnya(kesalahan);
    }
});

module.exports = router;