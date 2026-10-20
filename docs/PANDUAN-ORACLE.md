# Panduan: TikTik online percuma di Oracle Cloud (Always Free)

Hasil akhir: TikTik berjalan 24 jam di pautan **https** sendiri (walaupun komputer anda ditutup), dan
kawan-kawan boleh **"Install app"** di telefon Android atau iPhone. Hanya orang yang tahu **kod jemputan**
anda boleh mendaftar.

Anggaran masa: 45–60 minit (kali pertama).

---

## Apa yang anda perlukan

| Perkara | Nota |
|---|---|
| Akaun Oracle Cloud | Percuma. Kad bank diminta **untuk pengesahan sahaja** (mungkin ada caj sementara kecil yang dipulangkan). |
| Komputer Windows ini | Untuk memuat naik fail ke pelayan. |
| 2 fail yang sudah disediakan | `C:\REA-Projects\tiktik-server.tar.gz` (aplikasi) dan `C:\REA-Projects\tiktik-data.tar.gz` (akaun + video sedia ada, **pilihan**) |

> ⚠️ Kekal dalam sumber bertanda **"Always Free-eligible"** sahaja. Jangan naik taraf akaun kepada
> "Pay As You Go" melainkan anda faham cajnya.

---

## Langkah 1 – Daftar akaun Oracle Cloud

1. Buka <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Isi maklumat. Untuk **Home Region**, pilih **Singapore** (paling dekat dengan Malaysia).
   *Home Region tidak boleh ditukar kemudian.*
3. Sahkan e-mel dan kad bank. Tunggu sehingga akaun aktif (biasanya beberapa minit, kadang-kadang beberapa jam).

## Langkah 2 – Cipta pelayan (VM)

1. Log masuk ke <https://cloud.oracle.com> → menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name:** `tiktik`
3. **Image and shape** → **Edit**:
   - **Image:** *Canonical Ubuntu 24.04*
   - **Shape:** *Ampere* → **VM.Standard.A1.Flex** → **2 OCPU, 12 GB memory** (Always Free).
     - Jika keluar ralat **"Out of capacity"**, cuba lagi beberapa jam kemudian, **atau** pilih
       *Specialty and previous generation* → **VM.Standard.E2.1.Micro** (juga Always Free, lebih kecil tetapi cukup untuk kumpulan kecil).
4. **Networking:** biarkan default, pastikan **Assign a public IPv4 address** = *Yes*.
5. **Add SSH keys:** pilih **Generate a key pair for me** → klik **Save private key**.
   Simpan fail itu sebagai `C:\Users\User\.ssh\tiktik.key` (cipta folder `.ssh` jika tiada).
6. **Boot volume:** tanda *Specify a custom boot volume size* → **100 GB** (Always Free sehingga 200 GB jumlah).
7. Klik **Create**. Tunggu status **RUNNING**, kemudian salin **Public IP address** (contoh: `129.150.10.20`).

## Langkah 3 – Buka port 80 dan 443 (laman web)

1. Dalam halaman instance → **Primary VNIC** → klik nama **Subnet** → **Security** (atau *Security Lists*) → **Default Security List**.
2. **Add Ingress Rules** – tambah **dua** peraturan:

   | Source CIDR | IP Protocol | Destination Port Range |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

## Langkah 4 – Masuk ke pelayan dari Windows

Buka **PowerShell** di komputer anda dan jalankan (ganti `IP_ANDA`):

```powershell
icacls $env:USERPROFILE\.ssh\tiktik.key /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i $env:USERPROFILE\.ssh\tiktik.key ubuntu@IP_ANDA
```

Jika ditanya `Are you sure you want to continue connecting`, taip `yes`.
Anda kini berada di dalam pelayan (baris arahan bermula dengan `ubuntu@tiktik`).

## Langkah 5 – Sediakan pelayan (sekali sahaja)

Salin-tampal **di dalam pelayan**:

```bash
# buka port laman web dalam firewall Ubuntu (imej Oracle menyekatnya secara default)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# pasang Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

`exit` akan keluar dari pelayan. Masuk semula (arahan `ssh` di Langkah 4) supaya kebenaran Docker berkuat kuasa.

## Langkah 6 – Muat naik TikTik

Di **PowerShell komputer anda** (bukan di pelayan), ganti `IP_ANDA`:

```powershell
scp -i $env:USERPROFILE\.ssh\tiktik.key C:\REA-Projects\tiktik-server.tar.gz ubuntu@IP_ANDA:~
# Pilihan: bawa akaun dan video sedia ada
scp -i $env:USERPROFILE\.ssh\tiktik.key C:\REA-Projects\tiktik-data.tar.gz ubuntu@IP_ANDA:~
```

Kemudian **di dalam pelayan**:

```bash
tar -xzf tiktik-server.tar.gz          # menghasilkan folder ~/clipwave
cd ~/clipwave
mkdir -p data
# Pilihan: pulihkan akaun + video sedia ada
[ -f ~/tiktik-data.tar.gz ] && tar -xzf ~/tiktik-data.tar.gz -C ~/clipwave
# aplikasi berjalan sebagai pengguna 1000 – pastikan ia boleh menulis ke folder data
sudo chown -R 1000:1000 ~/clipwave/data
```

## Langkah 7 – Tetapkan alamat dan kod jemputan

```bash
cd ~/clipwave/deploy
cp .env.example .env
nano .env
```

Isi dua baris (ganti titik dalam IP dengan sengkang):

```
DOMAIN=129-150-10-20.sslip.io
INVITE_CODE=kodrahsiaanda
```

- `sslip.io` ialah perkhidmatan percuma yang memberi nama laman untuk IP anda – tiada pendaftaran domain diperlukan.
- `INVITE_CODE` – pilih kod rahsia sendiri. Kongsi hanya dengan kawan-kawan.

Simpan: tekan **Ctrl+O**, **Enter**, kemudian **Ctrl+X**.

## Langkah 8 – Hidupkan TikTik

```bash
cd ~/clipwave/deploy
docker compose up -d --build
```

Kali pertama mengambil 2–5 minit. Semak:

```bash
docker compose ps          # "app" mesti "running (healthy)" dan "caddy" mesti "running"
docker compose logs caddy | grep -i certificate   # sijil HTTPS diperoleh
```

Jika `app` menunjukkan `unhealthy`, lihat sebabnya dengan `docker compose logs app`.

Buka di pelayar: **`https://129-150-10-20.sslip.io`** (guna alamat anda). 🎉

## Langkah 9 – WAJIB: tukar kata laluan akaun contoh

Akaun contoh (`demo`, `mira.cooks`, dll.) menggunakan kata laluan yang diketahui umum. Jika anda
memulihkan data di Langkah 6, jalankan:

```bash
cd ~/clipwave/deploy
docker compose exec app node scripts/set-password.js --lock-seed
```

Kata laluan baharu akan dipaparkan – simpan di tempat selamat. Untuk tetapkan kata laluan sendiri:

```bash
docker compose exec app node scripts/set-password.js demo KataLaluanBaharu123
```

> Bio akaun `demo` masih menyebut kata laluan lama. Log masuk sebagai `demo` dan kemas kini bio di halaman profil.

## Langkah 10 – Lantik moderator (admin)

Moderator boleh membuka panel **Moderation** (`/admin`): menyemak laporan, menyembunyikan atau memadam
kandungan, menggantung akaun, dan menjana pautan reset kata laluan. Daftar akaun anda sendiri di laman
dahulu, kemudian:

```bash
cd ~/clipwave/deploy
docker compose exec app node scripts/set-admin.js NAMA_PENGGUNA_ANDA
docker compose exec app node scripts/set-admin.js --list      # semak senarai admin
```

Log keluar dan masuk semula; menu **Moderation** akan muncul di sebelah kiri (di telefon: menu **More**).

**Kawan lupa kata laluan?** Moderation → **Account tools** → taip nama pengguna → **Create reset link**.
Hantar pautan itu kepada kawan secara peribadi (contoh WhatsApp). Pautan berfungsi sekali sahaja, selama 30 minit.

## Langkah 11 – Kongsi dengan kawan-kawan

Hantar kepada kawan:
1. Pautan: `https://129-150-10-20.sslip.io`
2. Kod jemputan anda

**Pasang sebagai aplikasi:**
- **Android (Chrome):** buka pautan → menu **⋮** → **Install app** / **Add to Home screen**.
- **iPhone (Safari):** buka pautan → butang **Share** (kotak dengan anak panah) → **Add to Home Screen**.

Ikon TikTik akan muncul di skrin utama dan dibuka skrin penuh seperti aplikasi biasa.

---

## Penyelenggaraan

**Kemas kini aplikasi** (selepas perubahan baharu di komputer anda): buat semula `tiktik-server.tar.gz`,
muat naik (Langkah 6, fail server sahaja), kemudian di pelayan:

```bash
cd ~/clipwave/deploy && docker compose exec app node scripts/backup.js   # backup dahulu
cd ~ && tar -xzf tiktik-server.tar.gz && cd ~/clipwave/deploy && docker compose up -d --build
```

Folder `~/clipwave/data` (akaun + video) **tidak** disentuh oleh kemas kini. Jika versi baharu menambah
lajur pangkalan data, ia ditambah secara automatik semasa aplikasi bermula, tanpa kehilangan data.

**Sandaran (backup) automatik** – aplikasi menyimpan salinan pangkalan data setiap 24 jam di
`~/clipwave/data/backups` dan menyimpan 7 salinan terbaharu. Salinan ini selamat dibuat walaupun aplikasi
sedang berjalan. Untuk menukar jadual, tambah dalam `deploy/.env` (kemudian `docker compose up -d`):
`BACKUP_HOURS=12` (atau `0` untuk mematikan) dan `BACKUP_KEEP=14`.

**Salin backup ke komputer anda** – jalankan di PowerShell (membuat backup baharu dahulu, kemudian
memuat turun pangkalan data dan semua video):

```powershell
ssh -i $env:USERPROFILE\.ssh\tiktik.key ubuntu@IP_ANDA "cd ~/clipwave/deploy && docker compose exec -T app node scripts/backup.js >&2 && tar -czf - -C ~/clipwave/data backups uploads" > C:\REA-Projects\backup-tiktik.tar.gz
```

> Jangan salin fail `clipwave.db` secara terus semasa aplikasi berjalan – salinan begitu boleh rosak.
> Gunakan fail dalam folder `backups`.

**Pulihkan daripada backup** (di pelayan):

```bash
cd ~/clipwave/deploy && docker compose stop app
ls ~/clipwave/data/backups                       # pilih fail, contoh tiktik-20261020-030000.db
cp ~/clipwave/data/clipwave.db ~/clipwave/data/clipwave-sebelum-pulih.db
rm -f ~/clipwave/data/clipwave.db-wal ~/clipwave/data/clipwave.db-shm
cp ~/clipwave/data/backups/tiktik-20261020-030000.db ~/clipwave/data/clipwave.db
sudo chown 1000:1000 ~/clipwave/data/clipwave.db
docker compose start app
```

**Pilihan lanjutan: pautan reset melalui e-mel.** Tanpa tetapan ini, reset kata laluan dibuat oleh
moderator (Langkah 10). Untuk e-mel automatik, anda perlukan akaun SMTP (contoh Gmail dengan
*App Password*, Brevo atau Resend). Di komputer anda: `npm install nodemailer`, buat semula
`tiktik-server.tar.gz` dan kemas kini pelayan. Kemudian tambah dalam `deploy/.env`:

```
SMTP_URL=smtps://alamat%40gmail.com:APP_PASSWORD@smtp.gmail.com:465
MAIL_FROM=TikTik <alamat@gmail.com>
```

dan jalankan `docker compose up -d`. Pengguna perlu menambah e-mel mereka di **Edit profile**.

**Lihat log / mulakan semula:**

```bash
cd ~/clipwave/deploy
docker compose logs -f app      # Ctrl+C untuk keluar
docker compose restart
```

## Masalah biasa

| Masalah | Penyelesaian |
|---|---|
| "Out of capacity" semasa cipta VM | Cuba lagi kemudian, atau guna shape **VM.Standard.E2.1.Micro**. |
| Laman tidak dapat dibuka | Semak Langkah 3 (Ingress Rules) **dan** Langkah 5 (iptables). |
| HTTPS gagal / amaran sijil | Pastikan `DOMAIN` dalam `.env` betul (IP dengan sengkang + `.sslip.io`), kemudian `docker compose restart caddy`. |
| Kawan tidak boleh mendaftar | Mereka mesti isi **Invite code** yang tepat (huruf besar/kecil dikira). |
| Oracle menghantar e-mel "idle instance" | Oracle boleh menuntut semula VM Always Free yang hampir tidak digunakan selama 7 hari. Penggunaan biasa oleh kumpulan anda biasanya mencukupi; buat sandaran secara berkala. |

## Sebelum membuka kepada lebih ramai orang

- Halaman **Terms**, **Privacy Policy**, **Copyright** dan **Law Enforcement** masih **draf** – gantikan dengan teks rasmi (`public/js/views/info.js`).
- Tiada butang **lapor/report** atau alat moderasi lagi – sesuai untuk kumpulan kecil yang anda kenali sahaja.
