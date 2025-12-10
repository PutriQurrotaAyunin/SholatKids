import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, 
  Alert, ScrollView, StatusBar, Modal, Switch, BackHandler
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// --- TIPE DATA ---
interface LocalPrayerTimes {
  Subuh: string;
  Zuhur: string;
  Asar: string;
  Magrib: string;
  Isya: string;
  [key: string]: string;
}

interface StorageData {
  city: string;
  date: string;
  timings: LocalPrayerTimes;
}

const API_URL = 'http://api.aladhan.com/v1/timings'; 

export default function App() {
  // --- STATE UTAMA ---
  // Default 'welcome' agar Landing Page SELALU MUNCUL pertama kali
  const [viewMode, setViewMode] = useState<'welcome' | 'dashboard'>('welcome');

  // State Data
  const [locationName, setLocationName] = useState<string>('Mencari Lokasi...');
  const [currentDate, setCurrentDate] = useState<string>('-');
  const [prayerTimes, setPrayerTimes] = useState<LocalPrayerTimes | null>(null);
  const [nextPrayer, setNextPrayer] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>('--:--:--');
  
  // State UI & Logic
  const [loading, setLoading] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false); 
  const [isNotifEnabled, setIsNotifEnabled] = useState<boolean>(true); 

  // --- HELPER: FORMAT TANGGAL INDONESIA ---
  const formatDateToIndo = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  // --- 1. INITIAL LOAD (Load Data tapi TETAP di Welcome Screen) ---
  useEffect(() => {
    loadStoredData(); 
  }, []);

  // --- 2. TIMER HITUNG MUNDUR ---
  useEffect(() => {
    if (!prayerTimes || !nextPrayer) return;

    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = prayerTimes[nextPrayer];
      const [h, m] = timeStr.split(':').map(Number);
      
      const target = new Date();
      target.setHours(h, m, 0, 0);

      if (target.getTime() < now.getTime()) {
         target.setDate(target.getDate() + 1);
      }

      const diff = target.getTime() - now.getTime();
      
      if (diff <= 0) {
        setCountdown("00:00:00");
        calculateNextPrayer(prayerTimes); 
      } else {
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        const seconds = Math.floor((diff / 1000) % 60);
        setCountdown(
          `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [prayerTimes, nextPrayer]);

  // --- LOGIKA UTAMA ---
  const calculateNextPrayer = (timings: LocalPrayerTimes) => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    let upcoming = null;
    const prayerOrder = ['Subuh', 'Zuhur', 'Asar', 'Magrib', 'Isya'];

    for (const prayer of prayerOrder) {
      const timeStr = timings[prayer];
      const [h, m] = timeStr.split(':').map(Number);
      const prayerMinutes = h * 60 + m;
      if (prayerMinutes > currentMinutes) {
        upcoming = prayer;
        break;
      }
    }
    setNextPrayer(upcoming || 'Subuh');
  };

  const loadStoredData = async () => {
    try {
      const storedData = await AsyncStorage.getItem('prayerTimesLast');
      if (storedData) {
        const parsedData: StorageData = JSON.parse(storedData);
        setPrayerTimes(parsedData.timings);
        setLocationName(parsedData.city || 'Lokasi Tersimpan');
        setCurrentDate(parsedData.date);
        calculateNextPrayer(parsedData.timings);
        // Note: Kita TIDAK otomatis setViewMode('dashboard') di sini agar Welcome tetap muncul
      }
    } catch (error) { console.log('No local data'); }
  };

  // Fungsi Tombol "Gunakan Lokasi Saya" / "Masuk"
  const handleEnterApp = () => {
    if (prayerTimes && locationName !== 'Mencari Lokasi...') {
      // Jika data sudah ada, langsung masuk dashboard
      setViewMode('dashboard');
    } else {
      // Jika belum ada data, cari lokasi dulu
      handleGetLocationAndSchedule();
    }
  };

  const handleGetLocationAndSchedule = async () => {
    setLoading(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Izin Ditolak', 'Mohon izinkan lokasi agar aplikasi berjalan.');
        setLoading(false);
        return;
      }

      const { status: notifStatus } = await Notifications.requestPermissionsAsync();
      
      let location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;
      let geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
      const city = geocode[0]?.city || geocode[0]?.subregion || "Lokasi Saya";
      
      const dateUnix = Math.floor(Date.now() / 1000);
      const response = await fetch(`${API_URL}/${dateUnix}?latitude=${latitude}&longitude=${longitude}&method=11`);
      const json = await response.json();

      if (json.code === 200) {
        const data = json.data;
        const newTimings: LocalPrayerTimes = {
          Subuh: data.timings.Fajr,
          Zuhur: data.timings.Dhuhr,
          Asar: data.timings.Asr,
          Magrib: data.timings.Maghrib,
          Isya: data.timings.Isha,
        };
        
        const indoDate = formatDateToIndo(dateUnix);

        setPrayerTimes(newTimings);
        setLocationName(city);
        setCurrentDate(indoDate);
        calculateNextPrayer(newTimings);

        const dataToSave: StorageData = { city, date: indoDate, timings: newTimings };
        await AsyncStorage.setItem('prayerTimesLast', JSON.stringify(dataToSave));

        if (isNotifEnabled) scheduleNotifications(newTimings);
        
        // SUKSES -> PINDAH KE DASHBOARD
        setViewMode('dashboard');

      } else {
        Alert.alert('Gagal', 'Server error.');
      }
    } catch (error) {
      Alert.alert('Error', 'Cek koneksi internet.');
    } finally {
      setLoading(false);
    }
  };

  const scheduleNotifications = async (timings: LocalPrayerTimes) => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    // Alert.alert("Sukses", "Jadwal diperbarui & notifikasi diaktifkan!");
  };

  // --- RENDER COMPONENT ---

  // 1. TAMPILAN WELCOME (LANDING PAGE)
  if (viewMode === 'welcome') {
    return (
      <View style={styles.welcomeContainer}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.mosqueCard}>
           <MaterialCommunityIcons name="mosque" size={100} color="#fbbf24" style={{ marginBottom: 10 }} />
           <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
             <Ionicons name="sunny" size={40} color="#fbbf24" style={{ position: 'absolute', top: -40, right: -20 }} />
           </View>
        </View>
        
        <Text style={styles.welcomeTitle}>Selamat Datang!</Text>
        <Text style={styles.welcomeSubtitle}>Aplikasi ini membantumu mengetahui kapan waktunya sholat!</Text>
        <Text style={styles.welcomeDesc}>Untuk menemukan waktu sholat yang tepat, kami perlu tahu di mana lokasimu.</Text>

        <TouchableOpacity style={styles.tealButton} onPress={handleEnterApp} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.tealButtonText}>
              {prayerTimes ? "Lihat Jadwal Salat" : "Gunakan Lokasi Saya"}
            </Text>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity style={{ marginTop: 15 }} onPress={() => setViewMode('dashboard')}>
          <Text style={styles.skipText}>
            {prayerTimes ? "" : "Lewati untuk sekarang"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 2. TAMPILAN DASHBOARD
  return (
    <View style={styles.mainContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#f3f4f6" />
      
      {/* HEADER */}
      <View style={styles.header}>
        {/* Tombol Back ke Landing Page */}
        <TouchableOpacity onPress={() => setViewMode('welcome')} style={{ marginRight: 15 }}>
            <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="location-sharp" size={24} color="#000" />
            <Text style={styles.locationText}>{locationName}</Text>
          </View>
          <Text style={styles.dateText}>{currentDate}</Text>
        </View>
        
        <TouchableOpacity onPress={() => setShowSettings(true)}>
          <Ionicons name="settings-sharp" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        
        {/* HERO CARD */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Next up: {nextPrayer}</Text>
          <Text style={styles.heroTimer}>{countdown}</Text>
        </View>

        {/* LIST JADWAL */}
        {prayerTimes ? Object.entries(prayerTimes).map(([name, time]) => {
          const isActive = name === nextPrayer;
          let iconName: any = "weather-sunny";
          if (name === 'Subuh') iconName = "weather-sunset-up";
          if (name === 'Magrib') iconName = "weather-sunset-down";
          if (name === 'Isya') iconName = "moon-waning-crescent";

          return (
            <View key={name} style={[styles.prayerRow, isActive && styles.activeRow]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons name={iconName} size={20} color="#1f2937" style={{ width: 30 }} />
                <Text style={[styles.prayerText, { fontWeight: isActive ? 'bold' : 'normal' }]}>{name}</Text>
              </View>
              <Text style={[styles.prayerText, { fontWeight: 'bold' }]}>{time}</Text>
            </View>
          );
        }) : (
            <Text style={{ textAlign: 'center', marginTop: 20, color: '#9ca3af' }}>Data jadwal belum dimuat.</Text>
        )}

        <View style={styles.offlineBadge}>
           <MaterialCommunityIcons name="cloud-off-outline" size={12} color="#a1a1aa" style={{ marginRight: 5 }} />
           <Text style={{ fontSize: 10, color: '#a1a1aa' }}>Offline mode. Times from last sync.</Text>
        </View>

      </ScrollView>

      {/* --- MODAL SETTINGS --- */}
      <Modal animationType="slide" transparent={false} visible={showSettings} onRequestClose={() => setShowSettings(false)}>
        <View style={styles.settingsContainer}>
          <View style={styles.settingsHeader}>
            <TouchableOpacity onPress={() => setShowSettings(false)}>
              <Ionicons name="chevron-back" size={28} color="#000" />
            </TouchableOpacity>
            <Text style={styles.settingsTitle}>Pengaturan</Text>
            <View style={{ width: 28 }} />
          </View>

          <View style={{ alignItems: 'center', marginVertical: 30 }}>
            <View style={{ width: 80, height: 80, backgroundColor: '#fef3c7', borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 15 }}>
              <Ionicons name="moon" size={40} color="#fbbf24" />
            </View>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1f2937' }}>Waktu Sholat</Text>
            <Text style={{ color: '#9ca3af' }}>v1.0.1</Text>
          </View>

          <Text style={styles.sectionHeader}>NOTIFIKASI</Text>
          <View style={styles.menuItem}>
            <Text style={styles.menuText}>Aktifkan Pengingat Sholat</Text>
            <Switch 
              trackColor={{ false: "#767577", true: "#2dd4bf" }}
              thumbColor={isNotifEnabled ? "#fff" : "#f4f3f4"}
              onValueChange={setIsNotifEnabled}
              value={isNotifEnabled}
            />
          </View>
          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuText}>Suara & Peringatan</Text>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>

          <Text style={styles.sectionHeader}>TENTANG</Text>
          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuText}>Tentang Aplikasi</Text>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuText}>Kebijakan Privasi</Text>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuText}>Hubungi Kami / Kirim Masukan</Text>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  // WELCOME STYLES
  welcomeContainer: { flex: 1, backgroundColor: '#ffffff', padding: 30, justifyContent: 'center', alignItems: 'center' },
  mosqueCard: { width: 200, height: 200, backgroundColor: '#fef3c7', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 30 },
  welcomeTitle: { fontSize: 24, fontWeight: 'bold', color: '#1f2937', marginBottom: 10, textAlign: 'center' },
  welcomeSubtitle: { fontSize: 14, fontWeight: 'bold', color: '#374151', textAlign: 'center', marginBottom: 5 },
  welcomeDesc: { fontSize: 12, color: '#6b7280', textAlign: 'center', marginBottom: 40, lineHeight: 18, paddingHorizontal: 10 },
  tealButton: { backgroundColor: '#2dd4bf', width: '100%', paddingVertical: 15, borderRadius: 30, alignItems: 'center', shadowColor: "#2dd4bf", shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5 },
  tealButtonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  skipText: { color: '#9ca3af', fontSize: 12, textDecorationLine: 'underline' },

  // DASHBOARD STYLES
  mainContainer: { flex: 1, backgroundColor: '#f3f4f6', paddingTop: 50, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  locationText: { fontSize: 20, fontWeight: 'bold', color: '#000', marginLeft: 5 },
  dateText: { fontSize: 13, color: '#4b5563', marginTop: 4, marginLeft: 29 }, 
  
  heroCard: { backgroundColor: '#fef9c3', borderRadius: 20, padding: 25, alignItems: 'center', marginBottom: 25, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  heroLabel: { fontSize: 14, fontWeight: 'bold', color: '#1f2937', marginBottom: 5 },
  heroTimer: { fontSize: 48, fontWeight: 'bold', color: '#1f2937' },
  
  prayerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 16, paddingHorizontal: 20, borderRadius: 50, marginBottom: 10 },
  activeRow: { backgroundColor: '#facc15' },
  prayerText: { fontSize: 16, color: '#1f2937' },
  
  offlineBadge: { flexDirection: 'row', justifyContent: 'center', marginTop: 20, alignItems: 'center' },

  // SETTINGS STYLES
  settingsContainer: { flex: 1, backgroundColor: '#f9fafb', padding: 20, paddingTop: 50 },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingsTitle: { fontSize: 18, fontWeight: 'bold', color: '#000' },
  sectionHeader: { fontSize: 12, fontWeight: 'bold', color: '#9ca3af', marginTop: 20, marginBottom: 10, marginLeft: 5 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10 },
  menuText: { fontSize: 14, color: '#374151', fontWeight: '500' },
});