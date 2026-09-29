"use strict";

// ==========================================
// KONFIGURASI APLIKASI
// ==========================================
const KONFIGURASI = {
  baseUrl: window.location.origin,
  tokenCookie: "token_sesi",
  namaAplikasi: "PASAR MINI",
};

// ==========================================
// STATUS APLIKASI (STATE)
// ==========================================
const statusAplikasi = {
  penggunaTerotentikasi: null,
  tokenAktif: null,
  tampilanAktif: "dashboard",
};

// ==========================================
// FUNGSI UTILITAS
// ==========================================

/**
 * Ambil token dari cookie
 */
function ambilTokenDariCookie() {
  const namaCookie = KONFIGURASI.tokenCookie + "=";
  const daftarCookie = document.cookie.split(";");
  for (let cookie of daftarCookie) {
    cookie = cookie.trim();
    if (cookie.startsWith(namaCookie)) {
      return cookie.substring(namaCookie.length, cookie.length);
    }
  }
  return null;
}

/**
 * Tampilkan notifikasi toast
 */
function tampilkanNotifikasi(pesan, jenis = "info") {
  const elemenToast = document.getElementById("toast");
  if (!elemenToast) return;

  elemenToast.textContent = pesan;
  elemenToast.className = `toast toast-${jenis}`;
  elemenToast.style.display = "block";

  setTimeout(() => {
    elemenToast.style.display = "none";
  }, 3000);
}

/**
 * Format angka ke format Rupiah
 */
function formatRupiah(angka) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(angka || 0);
}

/**
 * Format tanggal ke format Indonesia
 */
function formatTanggal(tanggal) {
  if (!tanggal) return "-";
  return new Date(tanggal).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ==========================================
// FUNGSI API (FETCH)
// ==========================================

/**
 * Kirim permintaan ke API dengan token
 */
async function kirimPermintaanApi(url, opsi = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...opsi.headers,
  };

  // Tambahkan token jika ada
  if (statusAplikasi.tokenAktif) {
    headers["Authorization"] = `Bearer ${statusAplikasi.tokenAktif}`;
  }

  const respons = await fetch(`${KONFIGURASI.baseUrl}${url}`, {
    ...opsi,
    headers,
  });

  const data = await respons.json();

  if (!respons.ok) {
    throw new Error(data.error || "Terjadi kesalahan pada server");
  }

  return data;
}

// ==========================================
// FUNGSI AUTENTIKASI
// ==========================================

/**
 * Proses login
 */
async function prosesLogin(email, kataSandi) {
  try {
    const dataPengguna = await kirimPermintaanApi("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: kataSandi }),
    });

    statusAplikasi.penggunaTerotentikasi = dataPengguna;
    statusAplikasi.tokenAktif = dataPengguna.token || ambilTokenDariCookie();

    tampilkanNotifikasi(
      `Selamat datang, ${dataPengguna.name || email}!`,
      "sukses",
    );
    tampilkanAplikasiUtama();
  } catch (kesalahan) {
    tampilkanNotifikasi(kesalahan.message, "error");
    throw kesalahan;
  }
}

/**
 * Proses logout
 */
async function prosesLogout() {
  try {
    await kirimPermintaanApi("/api/auth/logout", { method: "POST" });
  } catch (kesalahan) {
    // Abaikan error logout
  }

  statusAplikasi.penggunaTerotentikasi = null;
  statusAplikasi.tokenAktif = null;
  tampilkanHalamanLogin();
  tampilkanNotifikasi("Anda telah keluar dari sistem", "info");
}

/**
 * Cek status autentikasi saat aplikasi dimuat
 */
async function cekStatusOtentikasi() {
  const token = ambilTokenDariCookie();
  if (!token) {
    tampilkanHalamanLogin();
    return;
  }

  try {
    statusAplikasi.tokenAktif = token;
    const dataPengguna = await kirimPermintaanApi("/api/auth/me");
    statusAplikasi.penggunaTerotentikasi = dataPengguna;
    tampilkanAplikasiUtama();
  } catch (kesalahan) {
    tampilkanHalamanLogin();
  }
}

// ==========================================
// FUNGSI TAMPILAN (VIEW)
// ==========================================

/**
 * Tampilkan halaman login
 */
function tampilkanHalamanLogin() {
  document.getElementById("login").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

/**
 * Tampilkan aplikasi utama setelah login
 */
function tampilkanAplikasiUtama() {
  document.getElementById("login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");

  const elemenSiapaSaya = document.getElementById("whoami");
  if (elemenSiapaSaya && statusAplikasi.penggunaTerotentikasi) {
    elemenSiapaSaya.textContent =
      statusAplikasi.penggunaTerotentikasi.name || "Pengguna";
  }

  // Muat tampilan default
  muatTampilan("dashboard");
}

/**
 * Muat tampilan berdasarkan menu yang dipilih
 */
async function muatTampilan(namaTampilan) {
  statusAplikasi.tampilanAktif = namaTampilan;
  const elemenView = document.getElementById("view");

  // Update navigasi aktif
  document.querySelectorAll("nav a[data-v]").forEach((tautan) => {
    tautan.classList.toggle("active", tautan.dataset.v === namaTampilan);
  });

  // Tampilkan loading
  elemenView.innerHTML = '<div class="loading">Memuat...</div>';

  try {
    switch (namaTampilan) {
      case "dashboard":
        await tampilkanDashboard(elemenView);
        break;
      case "finance":
        await tampilkanKeuangan(elemenView);
        break;
      case "pos":
        tampilkanKasir(elemenView);
        break;
      case "sales":
        tampilkanPenjualan(elemenView);
        break;
      case "purchases":
        tampilkanPembelian(elemenView);
        break;
      case "products":
        tampilkanProduk(elemenView);
        break;
      case "assets":
        tampilkanAset(elemenView);
        break;
      case "reports":
        tampilkanLaporan(elemenView);
        break;
      default:
        elemenView.innerHTML =
          '<div class="placeholder">Fitur dalam pengembangan</div>';
    }
  } catch (kesalahan) {
    elemenView.innerHTML = `<div class="error">Gagal memuat: ${kesalahan.message}</div>`;
    tampilkanNotifikasi(kesalahan.message, "error");
  }
}

// ==========================================
// TAMPILAN DASHBOARD
// ==========================================

async function tampilkanDashboard(elemenView) {
  try {
    // Ambil data saldo akun
    const daftarSaldo = await kirimPermintaanApi("/api/finance/akun");

    // Hitung total
    let totalKas = 0;
    let totalBank = 0;
    let totalPendapatan = 0;
    let totalBeban = 0;

    daftarSaldo.forEach((akun) => {
      if (akun.name === "Kas") totalKas = akun.balance || 0;
      if (akun.name === "Bank") totalBank = akun.balance || 0;
      if (akun.type === "revenue") totalPendapatan += akun.balance || 0;
      if (akun.type === "expense") totalBeban += akun.balance || 0;
    });

    const saldoBersih = totalPendapatan - totalBeban;

    elemenView.innerHTML = `
            <div class="dashboard">
                <h2> Dashboard Ringkasan</h2>
                <div class="kartu-ringkasan">
                    <div class="kartu">
                        <h3>💵 Total Kas</h3>
                        <p class="angka">${formatRupiah(totalKas)}</p>
                    </div>
                    <div class="kartu">
                        <h3>🏦 Total Bank</h3>
                        <p class="angka">${formatRupiah(totalBank)}</p>
                    </div>
                    <div class="kartu">
                        <h3>📈 Total Pendapatan</h3>
                        <p class="angka positif">${formatRupiah(totalPendapatan)}</p>
                    </div>
                    <div class="kartu">
                        <h3>📉 Total Beban</h3>
                        <p class="angka negatif">${formatRupiah(totalBeban)}</p>
                    </div>
                    <div class="kartu">
                        <h3>💰 Saldo Bersih</h3>
                        <p class="angka ${saldoBersih >= 0 ? "positif" : "negatif"}">${formatRupiah(saldoBersih)}</p>
                    </div>
                </div>
            </div>
        `;
  } catch (kesalahan) {
    throw kesalahan;
  }
}

// ==========================================
// TAMPILAN KEUANGAN
// ==========================================

async function tampilkanKeuangan(elemenView) {
  try {
    const [daftarPengeluaran, daftarPemasukan] = await Promise.all([
      kirimPermintaanApi("/api/finance/pengeluaran"),
      kirimPermintaanApi("/api/finance/pemasukan"),
    ]);

    elemenView.innerHTML = `
            <div class="keuangan">
                <h2>💰 Manajemen Keuangan</h2>
                
                <div class="form-transaksi">
                    <h3>Catat Transaksi Baru</h3>
                    <form id="formTransaksiKeuangan">
                        <div class="form-group">
                            <label>Jenis Transaksi</label>
                            <select name="jenis" required>
                                <option value="pengeluaran">Pengeluaran</option>
                                <option value="pemasukan">Pemasukan</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Tanggal</label>
                            <input type="date" name="tanggal" value="${new Date().toISOString().slice(0, 10)}" required>
                        </div>
                        <div class="form-group">
                            <label>Kategori</label>
                            <input type="text" name="kategori" placeholder="Contoh: Listrik, Sewa, dll" required>
                        </div>
                        <div class="form-group">
                            <label>Jumlah Nominal (Rp)</label>
                            <input type="number" name="jumlah_nominal" min="1" step="0.01" required>
                        </div>
                        <div class="form-group">
                            <label>Metode Pembayaran</label>
                            <select name="metode_pembayaran" required>
                                <option value="cash">Tunai</option>
                                <option value="transfer">Transfer</option>
                                <option value="qris">QRIS</option>
                                <option value="credit">Kredit</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Keterangan</label>
                            <textarea name="keterangan" rows="2"></textarea>
                        </div>
                        <button type="submit" class="btn primary">Simpan Transaksi</button>
                    </form>
                </div>

                <div class="daftar-transaksi">
                    <h3>📋 Riwayat Pemasukan (${daftarPemasukan.length})</h3>
                    <table class="tabel-data">
                        <thead>
                            <tr>
                                <th>Tanggal</th>
                                <th>Kategori</th>
                                <th>Jumlah</th>
                                <th>Metode</th>
                                <th>Keterangan</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${daftarPemasukan
                              .map(
                                (p) => `
                                <tr>
                                    <td>${formatTanggal(p.date)}</td>
                                    <td>${p.category}</td>
                                    <td class="positif">${formatRupiah(p.amount)}</td>
                                    <td>${p.payment_method}</td>
                                    <td>${p.description || "-"}</td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>

                    <h3>📋 Riwayat Pengeluaran (${daftarPengeluaran.length})</h3>
                    <table class="tabel-data">
                        <thead>
                            <tr>
                                <th>Tanggal</th>
                                <th>Kategori</th>
                                <th>Jumlah</th>
                                <th>Metode</th>
                                <th>Keterangan</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${daftarPengeluaran
                              .map(
                                (p) => `
                                <tr>
                                    <td>${formatTanggal(p.date)}</td>
                                    <td>${p.category}</td>
                                    <td class="negatif">${formatRupiah(p.amount)}</td>
                                    <td>${p.payment_method}</td>
                                    <td>${p.description || "-"}</td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

    // Tambahkan event listener untuk form
    const formTransaksi = document.getElementById("formTransaksiKeuangan");
    if (formTransaksi) {
      formTransaksi.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(formTransaksi);
        const dataTransaksi = {
          tanggal: formData.get("tanggal"),
          kategori: formData.get("kategori"),
          jumlah_nominal: parseFloat(formData.get("jumlah_nominal")),
          metode_pembayaran: formData.get("metode_pembayaran"),
          keterangan: formData.get("keterangan"),
        };

        const jenis = formData.get("jenis");
        const url =
          jenis === "pengeluaran"
            ? "/api/finance/pengeluaran"
            : "/api/finance/pemasukan";

        try {
          await kirimPermintaanApi(url, {
            method: "POST",
            body: JSON.stringify(dataTransaksi),
          });
          tampilkanNotifikasi("Transaksi berhasil disimpan!", "sukses");
          muatTampilan("finance"); // Refresh tampilan
        } catch (kesalahan) {
          tampilkanNotifikasi(kesalahan.message, "error");
        }
      });
    }
  } catch (kesalahan) {
    throw kesalahan;
  }
}

// ==========================================
// TAMPILAN PLACEHOLDER (Untuk menu lain)
// ==========================================

function tampilkanKasir(elemenView) {
  elemenView.innerHTML =
    '<div class="placeholder"><h2>🛒 Kasir/POS</h2><p>Fitur dalam pengembangan</p></div>';
}

function tampilkanPenjualan(elemenView) {
  elemenView.innerHTML =
    '<div class="placeholder"><h2>📦 Penjualan</h2><p>Fitur dalam pengembangan</p></div>';
}

function tampilkanPembelian(elemenView) {
  elemenView.innerHTML =
    '<div class="placeholder"><h2>️ Pembelian</h2><p>Fitur dalam pengembangan</p></div>';
}

function tampilkanProduk(elemenView) {
  elemenView.innerHTML =
    '<div class="placeholder"><h2>📦 Produk & Stok</h2><p>Fitur dalam pengembangan</p></div>';
}

function tampilkanAset(elemenView) {
  elemenView.innerHTML =
    '<div class="placeholder"><h2>🏢 Aset</h2><p>Fitur dalam pengembangan</p></div>';
}

function tampilkanLaporan(elemenView) {
  elemenView.innerHTML =
    '<div class="placeholder"><h2>📊 Laporan</h2><p>Fitur dalam pengembangan</p></div>';
}

// ==========================================
// INISIALISASI APLIKASI
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
  // Setup event listener untuk navigasi
  document.querySelectorAll("nav a[data-v]").forEach((tautan) => {
    tautan.addEventListener("click", (event) => {
      event.preventDefault();
      muatTampilan(tautan.dataset.v);
    });
  });

  // Setup event listener untuk logout
  const tombolLogout = document.getElementById("logoutBtn");
  if (tombolLogout) {
    tombolLogout.addEventListener("click", (event) => {
      event.preventDefault();
      if (confirm("Apakah Anda yakin ingin keluar?")) {
        prosesLogout();
      }
    });
  }

  // Setup event listener untuk form login
  const formLogin = document.getElementById("loginForm");
  if (formLogin) {
    formLogin.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(formLogin);
      const email = formData.get("email");
      const kataSandi = formData.get("password");

      const elemenError = document.getElementById("loginErr");
      if (elemenError) elemenError.textContent = "";

      try {
        await prosesLogin(email, kataSandi);
      } catch (kesalahan) {
        if (elemenError) {
          elemenError.textContent = kesalahan.message;
        }
      }
    });
  }

  // Cek status autentikasi saat aplikasi dimuat
  await cekStatusOtentikasi();
});
