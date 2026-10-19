// Web Serial ile ESP32'ye bağlantı (Chrome / Edge). Satır tabanlı protokol, RobotKol_PS4.ino ile aynı.
export class SeriBaglanti {
  constructor({ satir, durum }) {
    this.satir = satir;            // her gelen satır için çağrılır
    this.durum = durum;            // (bagli: bool, mesaj: string)
    this.bagli = false;
    this.zincir = Promise.resolve();
  }
  static destekli() { return 'serial' in navigator; }

  async baglan() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200 });
    this.yazici = this.port.writable.getWriter();
    this.bagli = true;
    this.durum(true, 'Bağlı');
    this.okuDongusu();
  }

  async kes() {
    await this.gonder('X');           // önce kolu durdur
    this.bagli = false;
    try { await this.okuyucu?.cancel(); } catch {}
    try { this.yazici?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.durum(false, 'Bağlı değil');
  }

  async okuDongusu() {
    const cozucu = new TextDecoder();
    let tampon = '';
    try {
      this.okuyucu = this.port.readable.getReader();
      while (this.bagli) {
        const { value, done } = await this.okuyucu.read();
        if (done) break;
        tampon += cozucu.decode(value, { stream: true });
        let n;
        while ((n = tampon.indexOf('\n')) >= 0) {
          const s = tampon.slice(0, n).trim();
          tampon = tampon.slice(n + 1);
          if (s) this.satir(s);
        }
      }
    } catch (e) {
      if (this.bagli) this.durum(false, 'Bağlantı koptu: ' + e.message);
    } finally {
      try { this.okuyucu.releaseLock(); } catch {}
      if (this.bagli) { this.bagli = false; this.durum(false, 'Bağlantı koptu'); }
    }
  }

  gonder(komut) {
    if (!this.bagli || !this.yazici) return Promise.resolve();
    const veri = new TextEncoder().encode(komut + '\n');
    this.zincir = this.zincir.then(() => this.yazici.write(veri)).catch(() => {});
    return this.zincir;
  }
}
