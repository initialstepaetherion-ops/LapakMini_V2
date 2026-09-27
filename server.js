require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const admin = require("firebase-admin");
const { getDatabase } = require('firebase-admin/database');
const midtransClient = require('midtrans-client'); 

// 1. Inisialisasi Firebase Admin
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : require('./firebase-key.json');
admin.initializeApp({
  credential: admin.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://vending-machine-a267f-default-rtdb.asia-southeast1.firebasedatabase.app"
});
const db = getDatabase();

// 2. Setup Midtrans
let snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// 3. Inisialisasi Server Express
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // PENTING: Untuk membaca index.html di folder public

// 4. API Status
app.get('/api/status', async (req, res) => {
  res.json({ success: true, message: "Server V2 aktif!" });
});

// 5. API Buat Transaksi (Dipanggil oleh index.html)
app.post('/api/buat-transaksi', async (req, res) => {
  try {
    const items = req.body.items;
    let grossAmount = 0;
    const itemDetails = items.map(item => {
      grossAmount += item.price * item.quantity;
      return { id: item.id_slot, price: item.price, quantity: item.quantity, name: item.name };
    });

    const order_id = "LAPAK-A1-V2-" + Date.now();
    const parameter = {
      transaction_details: { order_id: order_id, gross_amount: grossAmount },
      item_details: itemDetails,
      custom_field1: JSON.stringify(items) // Titip data barang di sini untuk webhook
    };

    const transaction = await snap.createTransaction(parameter);
    res.json({ success: true, token: transaction.token, order_id: order_id });
  } catch (error) {
    console.error("Error Midtrans:", error);
    res.status(500).json({ success: false, error: "Gagal memanggil Midtrans" });
  }
});

// 6. API Webhook (Khusus dipanggil oleh server Midtrans)
app.post('/api/midtrans-webhook', async (req, res) => {
  try {
    const notification = await snap.transaction.notification(req.body);
    const orderId = notification.order_id;
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    console.log(`[WEBHOOK] Status ${transactionStatus} untuk order ${orderId}`);

    if (transactionStatus == 'capture' || transactionStatus == 'settlement') {
        if (fraudStatus == 'accept' || !fraudStatus) {
            const itemsString = notification.custom_field1;
            if(itemsString) {
                const items = JSON.parse(itemsString);
                console.log("[WEBHOOK] PEMBAYARAN LUNAS! Mengirim perintah ke ESP32...");
                
                await db.ref('kontrol_iot/mesin_id_A1').set({
                  status: 'MENUNGGU_MESIN',
                  target_slot: items[0].id_slot,
                  queue_items: items
                });
                console.log("[WEBHOOK] Sukses kirim data Array ke Firebase!");
            }
        }
    }
    res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error("Error Webhook:", error);
    res.status(500).json({ error: "Terjadi kesalahan" });
  }
});

// 7. Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[🚀 SERVER V2 AKTIF] Berjalan di http://localhost:${PORT}`);
});