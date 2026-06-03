import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useState,
  useCallback
} from 'react';
import {
  Home as HomeIcon,
  Search as SearchIcon,
  Search,
  Library as LibraryIcon,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Volume2,
  VolumeX,
  Heart,
  Download,
  Check,
  Plus,
  MoreHorizontal,
  Clock,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  User,
  Settings as SettingsIcon,
  Trash2,
  ListMusic,
  Share2,
  Maximize2,
  Minimize2,
  Music,
  X,
  Edit,
  Mic,
  Moon,
  LogOut,
  CloudLightning,
  AlertCircle,
  Sliders,
  Filter,
  ChevronDown,
  MoreVertical,
  PlusCircle,
  CheckCircle
} from 'lucide-react';

// ==========================================
// 1. API Helper & CORS Handling
// ==========================================
const API_BASE = 'https://jiosaavn-api-gilt.vercel.app';
const CORS_PROXY = 'https://corsproxy.io/?';

// HTML Entity decoder helper
function decodeHtml(html) {
  if (!html) return '';
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

// Global API Fetch wrapper
async function apiFetch(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new Error('API fetch failed');
    const json = await res.json();
    return json.data || json;
  } catch (err) {
    console.error(`API Fetch Error on ${endpoint}:`, err);
    throw err;
  }
}

// CORS Fetch wrapper for files/images
async function fetchWithCORS(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return res;
  } catch (e) {
    console.warn(`Direct fetch failed for ${url}, trying proxy:`, e);
  }
  return fetch(`${CORS_PROXY}${encodeURIComponent(url)}`);
}

// Get proper stream URL based on quality setting
function getAudioUrlByQuality(song, quality) {
  if (!song || !song.downloadUrl || song.downloadUrl.length === 0) return '';
  let targetIndex = 4; // Default very high (320kbps)
  if (quality === 'low') targetIndex = 2; // 96kbps
  if (quality === 'normal') targetIndex = 3; // 160kbps
  if (quality === 'high') targetIndex = 4; // 320kbps
  if (quality === 'very_high') targetIndex = 4;

  while (targetIndex >= 0) {
    const item = song.downloadUrl[targetIndex];
    if (item && (item.url || item.link)) {
      return item.url || item.link;
    }
    targetIndex--;
  }
  for (let i = song.downloadUrl.length - 1; i >= 0; i--) {
    const item = song.downloadUrl[i];
    if (item && (item.url || item.link)) return item.url || item.link;
  }
  return '';
}

// Get proper image URL based on size index
function getImageUrl(item, sizeIndex = 2) {
  if (!item) return '';
  const imgArray = item.image || item.images;
  if (!imgArray || imgArray.length === 0) return 'https://placehold.co/150';
  let idx = sizeIndex;
  while (idx >= 0) {
    if (imgArray[idx]) {
      return imgArray[idx].url || imgArray[idx].link || '';
    }
    idx--;
  }
  for (let i = 0; i < imgArray.length; i++) {
    if (imgArray[i]) return imgArray[i].url || imgArray[i].link || '';
  }
  return 'https://placehold.co/150';
}

// Get proper artist name from song metadata
function getArtistName(song) {
  if (!song) return 'Unknown Artist';
  if (song.artists?.primary?.[0]?.name) return song.artists.primary[0].name;
  if (song.primaryArtists) return song.primaryArtists;
  if (song.artists) return song.artists;
  return 'Unknown Artist';
}

// Download a song offline helper
async function downloadSong(song, qualitySetting = 'high') {
  try {
    let fullSong = song;
    if (!fullSong.downloadUrl || fullSong.downloadUrl.length === 0) {
      try {
        const detailRes = await apiFetch(`/songs?id=${song.id}`);
        if (detailRes && detailRes.length > 0) {
          fullSong = detailRes[0];
        }
      } catch (fetchErr) {
        console.error("Failed to fetch full song details for download:", fetchErr);
      }
    }
    const audioUrl = getAudioUrlByQuality(fullSong, qualitySetting);
    const imageUrl = getImageUrl(fullSong, 2);
    
    // 1. Fetch audio blob (using cors proxy if needed)
    let audioBlob;
    try {
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error('Direct fetch failed');
      audioBlob = await res.blob();
    } catch {
      const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(audioUrl)}`;
      const res = await fetch(proxiedUrl);
      audioBlob = await res.blob();
    }
    
    // 2. Fetch image blob (using cors proxy if needed)
    let imageBlob = null;
    if (imageUrl && !imageUrl.includes('placehold.co')) {
      try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error('Direct fetch failed');
        imageBlob = await res.blob();
      } catch {
        const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(imageUrl)}`;
        const res = await fetch(proxiedUrl);
        imageBlob = await res.blob();
      }
    }
    
    // 3. Save song metadata + blobs in IndexedDB
    const songData = {
      id: fullSong.id,
      name: fullSong.name || fullSong.title || 'Unknown Song',
      artists: getArtistName(fullSong),
      album: fullSong.album?.name || fullSong.album || '',
      duration: fullSong.duration,
      audioBlob,
      imageBlob,
      downloadedAt: Date.now(),
      rawSong: fullSong // Save original structure
    };
    
    await saveDownload(songData);
    return true;
  } catch (err) {
    console.error('Download helper error:', err);
    throw err;
  }
}

// ==========================================
// 2. IndexedDB (Offline Storage)
// ==========================================
const DB_NAME = 'MusicPlayerDB';
const STORE_NAME = 'downloadedSongs';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getAllDownloads() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error loading IndexedDB:', error);
    return [];
  }
}

async function getDownload(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function saveDownload(songData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(songData);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function deleteDownload(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function clearAllDownloads() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// 3. State Management (Context & Reducer)
// ==========================================
const AppContext = createContext();

const initialReducerState = {
  currentSong: null,
  isPlaying: false,
  queue: [],
  queueIndex: 0,
  history: [],
  shuffle: false,
  repeat: localStorage.getItem('repeat') || 'off', // 'off' | 'all' | 'one'
  volume: parseFloat(localStorage.getItem('volume') || '0.8'),
  muted: false,
  likedSongs: JSON.parse(localStorage.getItem('likedSongs') || '[]'),
  playlists: JSON.parse(localStorage.getItem('playlists') || '[]'),
  downloadedSongs: [], // Hydrated on mount from DB
  recentlyPlayed: JSON.parse(localStorage.getItem('recentlyPlayed') || '[]'),
  currentView: 'home',
  currentViewData: null,
  searchQuery: '',
  searchResults: null,
  audioQuality: localStorage.getItem('audioQuality') || '320kbps',
};

function appReducer(state, action) {
  switch (action.type) {
    case 'SET_CURRENT_SONG': {
      const rpFiltered = state.recentlyPlayed.filter(s => s.id !== action.payload.id);
      const updatedRp = [action.payload, ...rpFiltered].slice(0, 20);
      localStorage.setItem('recentlyPlayed', JSON.stringify(updatedRp));

      return {
        ...state,
        currentSong: action.payload,
        recentlyPlayed: updatedRp,
        history: [...state.history, action.payload]
      };
    }
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.payload };
    case 'SET_QUEUE':
      return {
        ...state,
        queue: action.payload.songs || [],
        queueIndex: action.payload.index || 0
      };
    case 'SET_QUEUE_INDEX':
      return { ...state, queueIndex: action.payload };
    case 'TOGGLE_SHUFFLE': {
      const val = !state.shuffle;
      localStorage.setItem('shuffle', val ? 'true' : 'false');
      return { ...state, shuffle: val };
    }
    case 'SET_REPEAT':
      localStorage.setItem('repeat', action.payload);
      return { ...state, repeat: action.payload };
    case 'SET_VOLUME':
      localStorage.setItem('volume', action.payload.toString());
      return { ...state, volume: action.payload, muted: action.payload === 0 };
    case 'SET_MUTED':
      return { ...state, muted: action.payload };
    case 'TOGGLE_LIKE': {
      const exists = state.likedSongs.some(s => s.id === action.payload.id);
      let updated;
      if (exists) {
        updated = state.likedSongs.filter(s => s.id !== action.payload.id);
      } else {
        updated = [action.payload, ...state.likedSongs];
      }
      localStorage.setItem('likedSongs', JSON.stringify(updated));
      return { ...state, likedSongs: updated };
    }
    case 'CREATE_PLAYLIST': {
      const newList = {
        id: 'playlist_' + Date.now(),
        name: action.payload.name || `My Playlist #${state.playlists.length + 1}`,
        description: action.payload.description || '',
        songs: []
      };
      const updatedPl = [...state.playlists, newList];
      localStorage.setItem('playlists', JSON.stringify(updatedPl));
      return { ...state, playlists: updatedPl, currentView: 'playlist', currentViewData: newList };
    }
    case 'EDIT_PLAYLIST': {
      const updatedPl = state.playlists.map(pl => {
        if (pl.id === action.payload.id) {
          return { ...pl, name: action.payload.name, description: action.payload.description };
        }
        return pl;
      });
      localStorage.setItem('playlists', JSON.stringify(updatedPl));
      let currentVData = state.currentViewData;
      if (state.currentViewData && state.currentViewData.id === action.payload.id) {
        currentVData = { ...state.currentViewData, name: action.payload.name, description: action.payload.description };
      }
      return { ...state, playlists: updatedPl, currentViewData: currentVData };
    }
    case 'DELETE_PLAYLIST': {
      const updatedPl = state.playlists.filter(pl => pl.id !== action.payload);
      localStorage.setItem('playlists', JSON.stringify(updatedPl));
      return {
        ...state,
        playlists: updatedPl,
        currentView: 'home',
        currentViewData: null
      };
    }
    case 'ADD_TO_PLAYLIST': {
      const updatedPl = state.playlists.map(pl => {
        if (pl.id === action.payload.playlistId) {
          const songExists = pl.songs.some(s => s.id === action.payload.song.id);
          if (songExists) return pl;
          return { ...pl, songs: [...pl.songs, action.payload.song] };
        }
        return pl;
      });
      localStorage.setItem('playlists', JSON.stringify(updatedPl));
      let currentVData = state.currentViewData;
      if (state.currentViewData && state.currentViewData.id === action.payload.playlistId) {
        const selectedPl = updatedPl.find(pl => pl.id === action.payload.playlistId);
        currentVData = selectedPl;
      }
      return { ...state, playlists: updatedPl, currentViewData: currentVData };
    }
    case 'REMOVE_FROM_PLAYLIST': {
      const updatedPl = state.playlists.map(pl => {
        if (pl.id === action.payload.playlistId) {
          return { ...pl, songs: pl.songs.filter(s => s.id !== action.payload.songId) };
        }
        return pl;
      });
      localStorage.setItem('playlists', JSON.stringify(updatedPl));
      let currentVData = state.currentViewData;
      if (state.currentViewData && state.currentViewData.id === action.payload.playlistId) {
        const selectedPl = updatedPl.find(pl => pl.id === action.payload.playlistId);
        currentVData = selectedPl;
      }
      return { ...state, playlists: updatedPl, currentViewData: currentVData };
    }
    case 'SET_DOWNLOADS':
      return { ...state, downloadedSongs: action.payload };
    case 'SET_VIEW':
      return { ...state, currentView: action.payload.view, currentViewData: action.payload.data || null };
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload };
    case 'SET_SEARCH_RESULTS':
      return { ...state, searchResults: action.payload };
    case 'SET_QUALITY':
      localStorage.setItem('audioQuality', action.payload);
      return { ...state, audioQuality: action.payload };
    case 'CLEAR_HISTORY':
      localStorage.removeItem('recentlyPlayed');
      return { ...state, recentlyPlayed: [], history: [] };
    case 'LOG_OUT':
      localStorage.clear();
      return {
        ...initialReducerState,
        volume: 0.8,
        likedSongs: [],
        playlists: [],
        recentlyPlayed: [],
        downloadedSongs: []
      };
    default:
      return state;
  }
}

// App Provider wrapper
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialReducerState);
  const [toasts, setToasts] = useState([]);
  const [activeDownloads, setActiveDownloads] = useState({}); // songId -> progress percentage
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, song: null, playlistId: null });
  
  // Single persistent persistent Audio element
  const audioRef = useRef(new Audio());

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const playTrackGlobally = useCallback((songs, index) => {
    const song = songs[index];
    if (audioRef.current && song) {
      audioRef.current.currentSongId = song.id;
      
      const dbRecord = state.downloadedSongs?.find(s => s.id === song.id);
      let sourceUrl;
      if (dbRecord && dbRecord.audioBlob) {
        sourceUrl = URL.createObjectURL(dbRecord.audioBlob);
        if (audioRef.current.activeObjectUrl) {
          URL.revokeObjectURL(audioRef.current.activeObjectUrl);
        }
        audioRef.current.activeObjectUrl = sourceUrl;
      } else {
        if (song.isFresh && song.downloadUrl && song.downloadUrl.length > 0) {
          sourceUrl = getAudioUrlByQuality(song, state.audioQuality || 'high');
        }
      }

      if (sourceUrl) {
        audioRef.current.src = sourceUrl;
        audioRef.current.load();
        audioRef.current.play().catch(err => {
          console.warn("Synchronous playback failed:", err);
        });
      } else {
        audioRef.current.src = 'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABmYWN0BAAAAAAAAABkYXRhAAAAAA==';
        audioRef.current.play().catch(() => {});
      }
    }
    dispatch({ type: 'SET_QUEUE', payload: { songs, index } });
    dispatch({ type: 'SET_CURRENT_SONG', payload: song });
    dispatch({ type: 'SET_PLAYING', payload: true });
  }, [state.downloadedSongs, state.audioQuality]);

  return (
    <AppContext.Provider value={{ 
      state, 
      dispatch, 
      toasts, 
      showToast, 
      activeDownloads, 
      setActiveDownloads, 
      contextMenu, 
      setContextMenu,
      audioRef,
      playTrackGlobally
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

// ==========================================
// 4. Helper Components & Skeletons
// ==========================================
function ShimmerSkeleton({ className }) {
  return <div className={`skeleton-shimmer rounded-md ${className}`} />;
}

function HomePageSkeleton() {
  return (
    <div className="p-6 space-y-8 animate-pulse">
      <div className="h-10 w-48 rounded bg-neutral-800" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-20 rounded bg-neutral-800" />
        ))}
      </div>
      <div className="space-y-4">
        <div className="h-8 w-60 rounded bg-neutral-800" />
        <div className="flex space-x-4 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="w-44 h-56 rounded bg-neutral-800 flex-shrink-0" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaylistSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row items-end space-y-4 md:space-y-0 md:space-x-6">
        <div className="w-48 h-48 rounded bg-neutral-800 skeleton-shimmer flex-shrink-0" />
        <div className="space-y-2 w-full">
          <div className="h-4 w-24 bg-neutral-800 rounded skeleton-shimmer" />
          <div className="h-12 w-3/4 bg-neutral-800 rounded skeleton-shimmer" />
          <div className="h-4 w-1/2 bg-neutral-800 rounded skeleton-shimmer" />
        </div>
      </div>
      <div className="space-y-3 pt-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-neutral-800 rounded skeleton-shimmer" />
        ))}
      </div>
    </div>
  );
}

// Format seconds into mm:ss
function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity) return '0:00';
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

// Get responsive greeting based on local hour
function getGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

// ==========================================
// 5. Views / Pages Components
// ==========================================

// --- Home Page ---
function HomePage() {
  const { state, dispatch, playTrackGlobally } = useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ charts: [], trending: [], artists: [], newReleases: [] });

  const loadData = async () => {
    try {
      setLoading(true);
      // Run queries in parallel
      const [chartsRes, trendingRes, artistRes, releaseRes] = await Promise.all([
        apiFetch('/search/playlists?query=Top+50+India&limit=6'),
        apiFetch('/search/songs?query=Trending+Hindi&limit=15'),
        // Diljit Dosanjh search
        apiFetch('/search/artists?query=Arijit+Singh&limit=1'),
        apiFetch('/search/albums?query=Hindi+New+2024&limit=10')
      ]);

      // Fetch other artists as well to build a beautiful circles tray
      const [shreya, badshah, ap] = await Promise.all([
        apiFetch('/search/artists?query=Shreya+Ghoshal&limit=1'),
        apiFetch('/search/artists?query=Badshah&limit=1'),
        apiFetch('/search/artists?query=AP+Dhillon&limit=1')
      ]);

      const mergedArtists = [
        ...(artistRes?.results || []),
        ...(shreya?.results || []),
        ...(badshah?.results || []),
        ...(ap?.results || [])
      ];

      setData({
        charts: chartsRes?.results || [],
        trending: (trendingRes?.results || []).map(s => ({ ...s, isFresh: true })),
        artists: mergedArtists,
        newReleases: releaseRes?.results || []
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCardClick = (item, type) => {
    if (type === 'playlist') {
      dispatch({ type: 'SET_VIEW', payload: { view: 'playlist', data: item } });
    } else if (type === 'album') {
      dispatch({ type: 'SET_VIEW', payload: { view: 'album', data: item } });
    } else if (type === 'artist') {
      dispatch({ type: 'SET_VIEW', payload: { view: 'artist', data: item } });
    }
  };

  const handleSongPlay = (song) => {
    playTrackGlobally([song], 0);
  };

  if (loading) return <HomePageSkeleton />;

  // Mood categories list with static visual details
  const moods = [
    { name: 'Romantic', query: 'romantic hindi', color: 'from-pink-600 to-pink-900' },
    { name: 'Party', query: 'bollywood party', color: 'from-purple-600 to-indigo-900' },
    { name: 'Workout', query: 'workout hits energetic', color: 'from-orange-600 to-red-800' },
    { name: 'Sad', query: 'sad hindi slow', color: 'from-blue-700 to-gray-900' },
    { name: 'Punjabi', query: 'punjabi hits latest', color: 'from-yellow-600 to-amber-900' },
    { name: 'Retro', query: 'retro kishore kumar', color: 'from-emerald-700 to-teal-950' }
  ];

  return (
    <div className="p-6 space-y-10 pb-32">
      {/* Time greeting */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white mb-6">{getGreeting()}</h1>
        {/* Quick picks grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(state.recentlyPlayed.length > 0 ? state.recentlyPlayed.slice(0, 6) : data.trending.slice(0, 6)).map((song, i) => (
            <div
              key={song.id || i}
              className="flex items-center bg-[#1a1a1a] hover:bg-[#282828] transition duration-200 rounded-md overflow-hidden cursor-pointer group pr-4"
              onClick={() => handleSongPlay(song)}
            >
              <img
                src={getImageUrl(song, 2)}
                alt=""
                className="w-20 h-20 object-cover flex-shrink-0"
              />
              <div className="pl-4 pr-2 flex-grow overflow-hidden">
                <p className="font-semibold text-sm truncate text-white">{decodeHtml(song.name || song.title)}</p>
                <p className="text-xs text-neutral-400 truncate mt-1">
                  {decodeHtml(getArtistName(song))}
                </p>
              </div>
              <button
                className="w-10 h-10 bg-[#1db954] hover:scale-105 transition rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-md flex-shrink-0"
                aria-label="Play song"
              >
                <Play className="w-5 h-5 text-black fill-black ml-0.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Featured Charts */}
      {data.charts.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-white">Featured Charts</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.charts.map((chart) => (
              <div
                key={chart.id}
                className="bg-[#1a1a1a] hover:bg-[#282828] p-4 rounded-lg transition duration-300 cursor-pointer group flex flex-col h-full"
                onClick={() => handleCardClick(chart, 'playlist')}
              >
                <div className="relative mb-4 pb-[100%] rounded-md overflow-hidden bg-neutral-800">
                  <img
                    src={getImageUrl(chart, 2)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition duration-300"
                  />
                  <button
                    className="absolute bottom-2 right-2 w-10 h-10 bg-[#1db954] hover:scale-105 transition rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-xl"
                    aria-label="Play chart"
                  >
                    <Play className="w-5 h-5 text-black fill-black ml-0.5" />
                  </button>
                </div>
                <h3 className="font-bold text-sm text-white line-clamp-1">{decodeHtml(chart.name)}</h3>
                <p className="text-xs text-neutral-400 line-clamp-2 mt-1 flex-grow">{decodeHtml(chart.description)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trending songs list */}
      {data.trending.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-white">Trending Hits</h2>
          <div className="flex space-x-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-neutral-800">
            {data.trending.map((song) => (
              <div
                key={song.id}
                className="w-40 bg-[#1a1a1a] hover:bg-[#282828] p-4 rounded-lg flex-shrink-0 cursor-pointer transition duration-300 group"
                onClick={() => handleSongPlay(song)}
              >
                <div className="relative mb-3 pb-[100%] rounded overflow-hidden">
                  <img
                    src={getImageUrl(song, 2)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition"
                  />
                  <button
                    className="absolute bottom-2 right-2 w-10 h-10 bg-[#1db954] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-lg"
                    aria-label="Play song"
                  >
                    <Play className="w-5 h-5 text-black fill-black ml-0.5" />
                  </button>
                </div>
                <h3 className="font-semibold text-sm truncate text-white">{decodeHtml(song.name || song.title)}</h3>
                <p className="text-xs text-neutral-400 truncate mt-1">
                  {decodeHtml(getArtistName(song))}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Popular Artists circles list */}
      {data.artists.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-white">Popular Artists</h2>
          <div className="flex space-x-6 overflow-x-auto pb-2">
            {data.artists.map((artist) => (
              <div
                key={artist.id}
                className="flex flex-col items-center space-y-2 cursor-pointer group flex-shrink-0"
                onClick={() => handleCardClick(artist, 'artist')}
              >
                <div className="w-28 h-28 rounded-full overflow-hidden relative shadow-lg bg-neutral-800">
                  <img
                    src={getImageUrl(artist, 2)}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  />
                </div>
                <p className="text-sm font-semibold group-hover:text-white transition text-neutral-300">{decodeHtml(artist.name)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mood categories triggers */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold text-white">Choose your mood</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {moods.map((mood, idx) => (
            <div
              key={idx}
              className={`p-6 rounded-lg bg-gradient-to-br ${mood.color} hover:scale-[1.03] transition duration-200 cursor-pointer shadow-md flex items-end h-28 relative overflow-hidden`}
              onClick={() => {
                dispatch({ type: 'SET_VIEW', payload: { view: 'search', data: null } });
                dispatch({ type: 'SET_SEARCH_QUERY', payload: mood.query });
              }}
            >
              <div className="absolute top-2 right-2 opacity-15 rotate-12">
                <Moon className="w-16 h-16 text-white" />
              </div>
              <span className="font-bold text-lg text-white relative z-10">{mood.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* New Album Releases */}
      {data.newReleases.length > 0 && (
        <section className="space-y-4 pb-8">
          <h2 className="text-2xl font-bold text-white">New Releases</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.newReleases.map((album) => (
              <div
                key={album.id}
                className="bg-[#1a1a1a] hover:bg-[#282828] p-4 rounded-lg cursor-pointer transition group"
                onClick={() => handleCardClick(album, 'album')}
              >
                <div className="relative mb-3 pb-[100%] rounded overflow-hidden">
                  <img
                    src={getImageUrl(album, 2)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition"
                  />
                </div>
                <h3 className="font-bold text-sm truncate text-white">{decodeHtml(album.name)}</h3>
                <p className="text-xs text-neutral-400 truncate mt-1">
                  {decodeHtml(getArtistName(album))}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// --- Search Screen ---
function SearchPage() {
  const { state, dispatch, playTrackGlobally } = useApp();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('songs'); // 'songs'|'albums'|'artists'|'playlists'

  // Debounced search logic inside AppContainer triggers via state changes
  useEffect(() => {
    if (!state.searchQuery.trim()) {
      dispatch({ type: 'SET_SEARCH_RESULTS', payload: null });
      return;
    }
    const delay = setTimeout(async () => {
      try {
        setLoading(true);
        const [allRes, songsRes] = await Promise.all([
          apiFetch(`/search/all?query=${encodeURIComponent(state.searchQuery)}`),
          apiFetch(`/search/songs?query=${encodeURIComponent(state.searchQuery)}&limit=20`).catch(() => null)
        ]);
        if (allRes) {
          if (songsRes) {
            allRes.songs = songsRes;
          }
          dispatch({ type: 'SET_SEARCH_RESULTS', payload: allRes });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 450);

    return () => clearTimeout(delay);
  }, [state.searchQuery]);

  const handlePlaySong = (song) => {
    playTrackGlobally([song], 0);
  };

  const handleCardClick = (item, type) => {
    dispatch({ type: 'SET_VIEW', payload: { view: type, data: item } });
  };

  const genres = [
    { title: 'Bollywood', color: 'bg-[#e8115b]' },
    { title: 'Punjabi', color: 'bg-[#1e3264]' },
    { title: 'Pop', color: 'bg-[#148a08]' },
    { title: 'Hip-Hop', color: 'bg-[#bc5900]' },
    { title: 'Devotional', color: 'bg-[#7746bc]' },
    { title: 'Romance', color: 'bg-[#e1118c]' },
    { title: 'Party', color: 'bg-[#8d67ab]' },
    { title: 'Workout', color: 'bg-[#e13300]' },
    { title: 'Retro', color: 'bg-[#509bf5]' },
    { title: 'Ghazals', color: 'bg-[#006450]' },
    { title: 'Classical', color: 'bg-[#d84040]' }
  ];

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-neutral-800 rounded skeleton-shimmer" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-28 bg-neutral-800 rounded skeleton-shimmer" />
          ))}
        </div>
      </div>
    );
  }

  // Render static genres cards when search is empty
  if (!state.searchQuery.trim() || !state.searchResults) {
    return (
      <div className="p-6 space-y-8 pb-32">
        <h2 className="text-2xl font-bold text-white">Browse all</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {genres.map((g, idx) => (
            <div
              key={idx}
              className={`${g.color} hover:scale-[1.02] p-4 h-36 rounded-lg font-bold text-xl text-white relative cursor-pointer overflow-hidden shadow-md`}
              onClick={() => dispatch({ type: 'SET_SEARCH_QUERY', payload: g.title })}
            >
              <span>{g.title}</span>
              <div className="absolute right-0 bottom-0 w-16 h-16 translate-x-2 translate-y-2 rotate-12 opacity-40">
                <Music className="w-full h-full text-white" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Extract result nodes from search response object
  const songs = state.searchResults?.songs?.results || [];
  const albums = state.searchResults?.albums?.results || [];
  const artists = state.searchResults?.artists?.results || [];
  const playlists = state.searchResults?.playlists?.results || [];

  const topResult = songs[0];

  return (
    <div className="p-6 space-y-6 pb-32">
      {/* Search Type Tabs */}
      <div className="flex space-x-2 border-b border-neutral-800 pb-2">
        {['songs', 'albums', 'artists', 'playlists'].map((tab) => (
          <button
            key={tab}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition ${
              activeTab === tab
                ? 'bg-white text-black'
                : 'bg-neutral-800 text-white hover:bg-neutral-700'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'songs' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Top Result */}
          {topResult && (
            <div className="lg:col-span-2 space-y-3">
              <h2 className="text-xl font-bold text-white">Top Result</h2>
              <div
                className="bg-[#1a1a1a] hover:bg-[#252525] transition duration-300 p-6 rounded-lg flex flex-col justify-end relative group cursor-pointer h-[260px]"
                onClick={() => handlePlaySong(topResult)}
              >
                <img
                  src={getImageUrl(topResult, 2)}
                  alt=""
                  className="w-24 h-24 rounded-md object-cover shadow-lg mb-6"
                />
                <h3 className="text-2xl font-bold text-white truncate">{decodeHtml(topResult.name || topResult.title)}</h3>
                <div className="flex items-center space-x-2 mt-2">
                  <span className="text-xs text-neutral-400">Song</span>
                  <span className="w-1 h-1 rounded-full bg-neutral-600" />
                  <span className="text-xs font-semibold text-neutral-300 truncate">
                    {decodeHtml(getArtistName(topResult))}
                  </span>
                </div>
                <button
                  className="absolute bottom-6 right-6 w-12 h-12 bg-[#1db954] hover:scale-105 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-xl"
                  aria-label="Play top result"
                >
                  <Play className="w-6 h-6 text-black fill-black ml-0.5" />
                </button>
              </div>
            </div>
          )}

          {/* Songs list */}
          <div className="lg:col-span-3 space-y-3">
            <h2 className="text-xl font-bold text-white">Songs</h2>
            <div className="divide-y divide-neutral-900 bg-[#121212] rounded-lg">
              {songs.slice(0, 5).map((song) => (
                <div
                  key={song.id}
                  className="flex items-center justify-between p-2 hover:bg-neutral-800/60 rounded-md cursor-pointer group"
                  onClick={() => handlePlaySong(song)}
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <img
                      src={getImageUrl(song, 1)}
                      alt=""
                      className="w-10 h-10 rounded object-cover"
                    />
                    <div className="overflow-hidden">
                      <p className="font-semibold text-sm text-white truncate">{decodeHtml(song.name || song.title)}</p>
                      <p className="text-xs text-neutral-400 truncate">
                        {decodeHtml(getArtistName(song))}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-neutral-400 pr-2">{formatTime(song.duration)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'albums' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {albums.map((album) => (
            <div
              key={album.id}
              className="bg-[#1a1a1a] hover:bg-[#282828] p-4 rounded-lg cursor-pointer transition group"
              onClick={() => handleCardClick(album, 'album')}
            >
              <div className="relative mb-3 pb-[100%] rounded overflow-hidden">
                <img
                  src={getImageUrl(album, 2)}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition"
                />
              </div>
              <h3 className="font-bold text-sm truncate text-white">{decodeHtml(album.name)}</h3>
              <p className="text-xs text-neutral-400 truncate mt-1">
                {decodeHtml(getArtistName(album))}
              </p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'artists' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {artists.map((artist) => (
            <div
              key={artist.id}
              className="bg-[#1a1a1a] hover:bg-[#282828] p-4 rounded-lg cursor-pointer transition flex flex-col items-center text-center"
              onClick={() => handleCardClick(artist, 'artist')}
            >
              <div className="w-24 h-24 rounded-full overflow-hidden mb-3 relative shadow-md bg-neutral-800">
                <img
                  src={getImageUrl(artist, 2)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <h3 className="font-bold text-sm truncate text-white w-full">{decodeHtml(artist.name)}</h3>
              <span className="text-xs text-neutral-400 mt-1">Artist</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'playlists' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className="bg-[#1a1a1a] hover:bg-[#282828] p-4 rounded-lg cursor-pointer transition group"
              onClick={() => handleCardClick(pl, 'playlist')}
            >
              <div className="relative mb-3 pb-[100%] rounded overflow-hidden">
                <img
                  src={getImageUrl(pl, 2)}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
              <h3 className="font-bold text-sm truncate text-white">{decodeHtml(pl.name)}</h3>
              <p className="text-xs text-neutral-400 truncate mt-1">{decodeHtml(pl.description)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Library Screen ---
function LibraryPage() {
  const { state, dispatch, showToast, playTrackGlobally } = useApp();
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All'); // 'All' | 'Playlists' | 'Downloads' | 'Favorites' | 'Recently Played'

  const handleSelectPlaylist = (pl) => {
    if (pl.isExample) {
      // Hydrate with some popular song IDs or tracks so they can actually listen to songs!
      const mockSongs = [
        { id: 'mock-1', name: 'Midnight City', title: 'Midnight City', artists: { primary: [{ name: 'M83' }] }, duration: 243, image: 'https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png' },
        { id: 'mock-2', name: 'Starboy', title: 'Starboy', artists: { primary: [{ name: 'The Weeknd' }] }, duration: 230, image: 'https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png' },
        { id: 'mock-3', name: 'Sweater Weather', title: 'Sweater Weather', artists: { primary: [{ name: 'The Neighbourhood' }] }, duration: 240, image: 'https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png' }
      ];
      dispatch({ type: 'SET_VIEW', payload: { view: 'playlist', data: { ...pl, songs: mockSongs } } });
    } else {
      dispatch({ type: 'SET_VIEW', payload: { view: 'playlist', data: pl } });
    }
  };

  const handleSelectLiked = () => {
    dispatch({ type: 'SET_VIEW', payload: { view: 'liked', data: null } });
  };

  const handleSelectDownloaded = () => {
    dispatch({ type: 'SET_VIEW', payload: { view: 'downloaded', data: null } });
  };

  const handleCreatePlaylist = () => {
    const name = prompt("Enter playlist name:");
    if (name) {
      dispatch({ type: 'CREATE_PLAYLIST', payload: { name } });
      showToast(`Created playlist "${name}"`);
    }
  };

  const handlePlaylistMenu = (e, pl) => {
    e.stopPropagation();
    if (pl.isExample) {
      showToast("Example playlists cannot be modified.");
      return;
    }
    if (confirm(`Delete playlist "${pl.name}"?`)) {
      dispatch({ type: 'DELETE_PLAYLIST', payload: pl.id });
      showToast(`Deleted playlist "${pl.name}"`);
    }
  };

  // Calculations for subtitle counts
  const totalPlaylists = state.playlists.length;
  const totalLiked = state.likedSongs.length;
  const totalDownloaded = state.downloadedSongs.length;
  const totalPlaylistSongs = state.playlists.reduce((acc, curr) => acc + (curr.songs?.length || 0), 0);
  const totalSongs = totalPlaylistSongs + totalLiked + totalDownloaded;

  // Default Example Playlists
  const defaultExamplePlaylists = [
    { id: 'ex-1', name: 'Workout Mix', songs: [{}, {}, {}, {}, {}], isExample: true, color: 'from-[#FF512F] to-[#DD2476]' },
    { id: 'ex-2', name: 'Sad Songs', songs: [{}, {}, {}, {}], isExample: true, color: 'from-[#1A2980] to-[#26D0CE]' },
    { id: 'ex-3', name: 'Lo-Fi Night', songs: [{}, {}, {}, {}, {}, {}, {}], isExample: true, color: 'from-[#0F2027] to-[#2C5364]' },
    { id: 'ex-4', name: 'Road Trip', songs: [{}, {}, {}, {}, {}, {}], isExample: true, color: 'from-[#F7971E] to-[#FF007F]' },
    { id: 'ex-5', name: 'Party Hits', songs: [{}, {}, {}, {}, {}, {}, {}, {}], isExample: true, color: 'from-[#11998e] to-[#38ef7d]' },
    { id: 'ex-6', name: 'Chill Vibes', songs: [{}, {}, {}], isExample: true, color: 'from-[#8E2DE2] to-[#4A00E0]' }
  ];

  // Combine user playlists and examples
  const playlistsToShow = [
    ...state.playlists.map(pl => ({
      ...pl,
      isExample: false,
      color: 'from-neutral-800 to-neutral-900'
    })),
    ...defaultExamplePlaylists.filter(ex => !state.playlists.some(pl => pl.name.toLowerCase() === ex.name.toLowerCase()))
  ];

  const filteredPlaylists = playlistsToShow.filter(pl =>
    pl.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  // Collage logic
  const renderPlaylistCollage = (playlist) => {
    const songs = playlist.songs || [];
    const images = songs.map(s => getImageUrl(s, 0)).filter(Boolean);

    if (images.length >= 4) {
      return (
        <div className="grid grid-cols-2 grid-rows-2 w-full h-full rounded-[18px] overflow-hidden">
          <img src={images[0]} className="w-full h-full object-cover" alt="" />
          <img src={images[1]} className="w-full h-full object-cover" alt="" />
          <img src={images[2]} className="w-full h-full object-cover" alt="" />
          <img src={images[3]} className="w-full h-full object-cover" alt="" />
        </div>
      );
    } else if (images.length > 0) {
      return (
        <img src={images[0]} className="w-full h-full object-cover rounded-[18px]" alt="" />
      );
    }

    const gradient = playlist.color || 'from-[#2a2a2a] to-[#121212]';
    return (
      <div className={`w-full h-full rounded-[18px] bg-gradient-to-br ${gradient} flex items-center justify-center relative overflow-hidden`}>
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
        <Music className="w-8 h-8 text-white/60 relative z-10" />
        <div className="absolute -bottom-4 -right-4 w-12 h-12 rounded-full bg-white/10 blur-md" />
        <div className="absolute -top-4 -left-4 w-16 h-16 rounded-full bg-white/5 blur-lg" />
      </div>
    );
  };

  const renderPlaylistCard = (playlist) => {
    return (
      <div 
        key={playlist.id}
        onClick={() => handleSelectPlaylist(playlist)}
        className="group bg-white/5 border border-white/10 hover:bg-white/10 p-4 rounded-[24px] cursor-pointer transition-all duration-300 relative flex flex-col justify-between"
      >
        <div className="w-full aspect-square rounded-[18px] overflow-hidden shadow-lg relative mb-3 group-hover:scale-[1.02] transition-transform duration-300">
          {renderPlaylistCollage(playlist)}
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-[18px]">
            <div className="w-12 h-12 rounded-full bg-[#1DB954] flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-100">
              <Play className="w-5 h-5 fill-current text-black translate-x-[1px]" />
            </div>
          </div>
        </div>
        
        <div className="flex items-start justify-between px-1">
          <div className="overflow-hidden pr-2 flex-grow">
            <h3 className="font-bold text-sm text-white truncate tracking-tight">{playlist.name}</h3>
            <span className="text-xs text-neutral-400 mt-1 block">
              {playlist.isExample ? "Example" : "Playlist"} • {playlist.songs?.length || 0} songs
            </span>
          </div>
          <button 
            onClick={(e) => handlePlaylistMenu(e, playlist)}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center flex-shrink-0 transition"
          >
            <MoreHorizontal className="w-5 h-5 text-neutral-400 hover:text-white" />
          </button>
        </div>
      </div>
    );
  };

  // Song list view helper
  const renderSongList = (songsList, emptyMessage) => {
    const filteredSongs = songsList.filter(s => 
      (s.name || s.title || '').toLowerCase().includes(searchFilter.toLowerCase()) || 
      getArtistName(s).toLowerCase().includes(searchFilter.toLowerCase())
    );

    if (filteredSongs.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-neutral-500 bg-white/5 border border-white/10 rounded-[24px]">
          <Music className="w-12 h-12 mb-4 opacity-40" />
          <p className="text-sm font-medium">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {filteredSongs.map((song, i) => (
          <div
            key={song.id || i}
            onClick={() => playTrackGlobally(song)}
            className="flex items-center justify-between p-3.5 rounded-[20px] bg-white/5 border border-white/5 hover:bg-white/10 transition cursor-pointer group"
          >
            <div className="flex items-center space-x-4 overflow-hidden flex-grow pr-4">
              <span className="text-sm font-bold text-neutral-500 w-5 text-center group-hover:text-[#1DB954] transition">
                {i + 1}
              </span>
              <img
                src={getImageUrl(song, 0)}
                alt=""
                className="w-12 h-12 object-cover rounded-xl shadow-md flex-shrink-0"
              />
              <div className="overflow-hidden">
                <p className="font-bold text-white text-sm truncate group-hover:text-[#1DB954] transition">
                  {decodeHtml(song.name || song.title)}
                </p>
                <p className="text-xs text-neutral-400 truncate mt-0.5">
                  {decodeHtml(getArtistName(song))}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4 flex-shrink-0">
              <span className="text-xs text-neutral-400 font-semibold">
                {formatTime(song.duration)}
              </span>
              <div className="w-8 h-8 rounded-full bg-[#1DB954] text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-md">
                <Play className="w-3.5 h-3.5 fill-current text-black translate-x-[0.5px]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Quick cards configuration
  const quickCards = [
    {
      title: "Liked Songs",
      subtitle: `${state.likedSongs.length} Songs`,
      icon: <Heart className="w-6 h-6 text-white fill-white" />,
      gradient: "from-[#FF3366] to-[#BA2649]",
      shadow: "shadow-[#FF3366]/20",
      action: handleSelectLiked
    },
    {
      title: "Downloads",
      subtitle: `${state.downloadedSongs.length} Songs`,
      icon: <Download className="w-6 h-6 text-white" />,
      gradient: "from-[#00E5FF] to-[#007799]",
      shadow: "shadow-[#00E5FF]/20",
      action: handleSelectDownloaded
    },
    {
      title: "Recently Played",
      subtitle: `${state.recentlyPlayed.length} Tracks`,
      icon: <Clock className="w-6 h-6 text-white" />,
      gradient: "from-[#7B2CBF] to-[#3C096C]",
      shadow: "shadow-[#7B2CBF]/20",
      action: () => setSelectedCategory('Recently Played')
    },
    {
      title: "Most Played",
      subtitle: `${Math.max(12, state.likedSongs.length + 5)} Tracks`,
      icon: <ListMusic className="w-6 h-6 text-white" />,
      gradient: "from-[#F15BB5] to-[#9B5DE5]",
      shadow: "shadow-[#F15BB5]/20",
      action: () => {
        showToast("Playing your most played songs...");
        if (state.likedSongs.length > 0) {
          playTrackGlobally(state.likedSongs[0]);
        }
      }
    }
  ];

  // Featured continue listening song
  const featuredSong = state.currentSong || (state.recentlyPlayed.length > 0 ? state.recentlyPlayed[0] : null) || null;
  const displaySong = featuredSong || {
    id: 'mock-featured',
    name: 'Lo-Fi Chill Beats',
    title: 'Lo-Fi Chill Beats',
    artists: { primary: [{ name: 'Lofi Records' }] },
    image: 'https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png',
    duration: 180
  };

  const isCurrentlyPlaying = state.currentSong && state.isPlaying && state.currentSong.id === displaySong.id;
  const progressPercent = isCurrentlyPlaying ? 45 : 68; 
  const remainingTimeStr = isCurrentlyPlaying ? "1:42 remaining" : "0:56 remaining";

  const handleFeaturedPlay = (e) => {
    e.stopPropagation();
    if (state.currentSong?.id === displaySong.id) {
      dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying });
    } else {
      playTrackGlobally(displaySong);
    }
  };

  // Recent activity setup
  const lastLiked = state.likedSongs.length > 0 ? state.likedSongs[state.likedSongs.length - 1] : null;
  const lastDownloaded = state.downloadedSongs.length > 0 ? state.downloadedSongs[state.downloadedSongs.length - 1] : null;
  const lastPlayed = state.recentlyPlayed.length > 0 ? state.recentlyPlayed[0] : null;

  const renderActivityCard = (label, song, defaultSong) => {
    const activeSong = song || defaultSong;
    return (
      <div 
        onClick={() => playTrackGlobally(activeSong)}
        className="flex items-center space-x-4 p-4 rounded-[24px] bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 cursor-pointer group"
      >
        <img
          src={getImageUrl(activeSong, 1)}
          alt=""
          className="w-14 h-14 object-cover rounded-2xl shadow-md flex-shrink-0 group-hover:scale-105 transition-transform duration-300"
        />
        <div className="overflow-hidden flex-grow">
          <span className="text-[9px] uppercase font-bold tracking-widest text-[#1DB954] block mb-0.5">
            {label}
          </span>
          <h4 className="font-bold text-sm text-white truncate">{decodeHtml(activeSong.name || activeSong.title)}</h4>
          <p className="text-xs text-neutral-400 truncate mt-0.5">{decodeHtml(getArtistName(activeSong))}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-white/5 group-hover:bg-[#1DB954] group-hover:text-black flex items-center justify-center flex-shrink-0 transition-all duration-300 shadow-sm">
          <Play className="w-3.5 h-3.5 fill-current text-white group-hover:text-black translate-x-[0.5px] transition-colors duration-300" />
        </div>
      </div>
    );
  };

  const renderCategoryContent = () => {
    switch (selectedCategory) {
      case 'Playlists':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white tracking-tight">Playlists</h2>
              <span className="text-xs text-neutral-400 font-semibold">{filteredPlaylists.length} Playlists</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
              {filteredPlaylists.map(pl => renderPlaylistCard(pl))}
            </div>
          </div>
        );
      case 'Downloads':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white tracking-tight">Downloaded Songs</h2>
              <span className="text-xs text-neutral-400 font-semibold">{state.downloadedSongs.length} Songs</span>
            </div>
            {renderSongList(state.downloadedSongs, "No downloaded songs found. Start downloading tracks for offline playback!")}
          </div>
        );
      case 'Favorites':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white tracking-tight">Favorites & Liked Songs</h2>
              <span className="text-xs text-neutral-400 font-semibold">{state.likedSongs.length} Songs</span>
            </div>
            {renderSongList(state.likedSongs, "No liked songs yet. Tap the heart icon on any song to add it here!")}
          </div>
        );
      case 'Recently Played':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white tracking-tight">Recently Played</h2>
              <span className="text-xs text-neutral-400 font-semibold">{state.recentlyPlayed.length} Tracks</span>
            </div>
            {renderSongList(state.recentlyPlayed, "No recently played tracks yet. Choose a song and start listening!")}
          </div>
        );
      case 'All':
      default:
        return (
          <div className="space-y-10">
            {/* Quick Access */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white tracking-tight">Quick Access</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {quickCards.map((card) => (
                  <div
                    key={card.title}
                    onClick={card.action}
                    className={`relative overflow-hidden rounded-[24px] p-6 bg-gradient-to-br ${card.gradient} cursor-pointer transform hover:scale-[1.03] active:scale-95 transition-all duration-300 shadow-xl group border border-white/10`}
                  >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-4 shadow-sm">
                      {card.icon}
                    </div>
                    <span className="text-xs text-white/70 font-semibold uppercase tracking-wider">{card.subtitle}</span>
                    <h3 className="text-lg font-black text-white mt-1 tracking-tight">{card.title}</h3>
                  </div>
                ))}
              </div>
            </div>

            {/* Continue Listening */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white tracking-tight">Continue Listening</h2>
              <div 
                onClick={() => playTrackGlobally(displaySong)}
                className="relative overflow-hidden rounded-[24px] bg-white/5 border border-white/10 p-6 flex flex-col md:flex-row md:items-center justify-between shadow-2xl cursor-pointer group hover:bg-white/10 transition-all duration-300"
              >
                <div className="absolute top-0 right-0 w-44 h-44 bg-[#1DB954]/10 rounded-full blur-[60px] pointer-events-none -z-10" />
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-[50px] pointer-events-none -z-10" />
                
                <div className="flex items-center space-x-5 flex-grow overflow-hidden mr-4">
                  <img
                    src={getImageUrl(displaySong, 1)}
                    alt=""
                    className="w-20 h-20 md:w-24 md:h-24 rounded-[20px] object-cover shadow-2xl flex-shrink-0 group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="overflow-hidden flex-grow space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-[#1DB954]">
                      {isCurrentlyPlaying ? "Now Playing" : "Continue Listening"}
                    </span>
                    <h3 className="text-xl font-extrabold text-white tracking-tight truncate">
                      {decodeHtml(displaySong.name || displaySong.title)}
                    </h3>
                    <p className="text-xs font-semibold text-neutral-400 truncate">
                      {decodeHtml(getArtistName(displaySong))}
                    </p>
                    
                    <div className="pt-3 max-w-md hidden sm:block">
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                        <div 
                          className="h-full bg-gradient-to-r from-[#1DB954] to-[#1ed760] rounded-full transition-all duration-500"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-neutral-500 font-semibold mt-1.5">
                        <span>{formatTime(Math.floor((displaySong.duration || 180) * (progressPercent / 100)))}</span>
                        <span>{remainingTimeStr}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between md:justify-end mt-4 md:mt-0 flex-shrink-0">
                  <div className="sm:hidden flex-grow pr-4">
                    <div className="w-28 h-1 bg-white/10 rounded-full overflow-hidden relative">
                      <div 
                        className="h-full bg-[#1DB954] rounded-full"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-neutral-500 mt-1 block">{remainingTimeStr}</span>
                  </div>
                  
                  <button
                    onClick={handleFeaturedPlay}
                    className="w-14 h-14 rounded-full bg-[#1DB954] text-black shadow-[0_6px_20px_rgba(29,185,84,0.4)] flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer"
                  >
                    {isCurrentlyPlaying ? (
                      <Pause className="w-6 h-6 fill-current text-black" />
                    ) : (
                      <Play className="w-6 h-6 fill-current text-black translate-x-[1px]" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* My Playlists */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white tracking-tight">My Playlists</h2>
                <button
                  onClick={() => setSelectedCategory('Playlists')}
                  className="text-xs text-[#1DB954] hover:underline font-bold"
                >
                  See All
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
                {filteredPlaylists.map(pl => renderPlaylistCard(pl))}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white tracking-tight">Recent Activity</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {renderActivityCard("Recently Added", lastLiked, {
                  id: 'mock-added',
                  name: 'Midnight City',
                  artists: { primary: [{ name: 'M83' }] },
                  image: 'https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png',
                  duration: 243
                })}
                {renderActivityCard("Recently Downloaded", lastDownloaded, {
                  id: 'mock-down',
                  name: 'Sweater Weather',
                  artists: { primary: [{ name: 'The Neighbourhood' }] },
                  image: 'https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png',
                  duration: 240
                })}
                {renderActivityCard("Recently Played", lastPlayed, {
                  id: 'mock-played',
                  name: 'Starboy',
                  artists: { primary: [{ name: 'The Weeknd' }] },
                  image: 'https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png',
                  duration: 230
                })}
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-full bg-[#121212] px-6 pt-8 pb-32 space-y-6 relative overflow-hidden select-none">
      {/* Visual background ambient blobs */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/3 -right-32 w-80 h-80 bg-emerald-600/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Title section */}
      <div className="space-y-1">
        <h1 className="text-4xl font-extrabold text-white tracking-tight">Your Library</h1>
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
          {totalPlaylists} Playlists • {totalSongs} Songs
        </p>
      </div>

      {/* Modern glassmorphism search bar */}
      <div className="relative w-full">
        <div 
          className="flex items-center w-full bg-white/5 backdrop-blur-lg border border-white/10 rounded-[18px] transition-all duration-300 focus-within:bg-white/10 focus-within:border-white/20"
          style={{ padding: '14px 16px' }}
        >
          <Search className="w-5 h-5 text-neutral-400 mr-3 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search in Library..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full bg-transparent text-white border-none focus:outline-none focus:ring-0 p-0 text-sm placeholder-neutral-400 font-semibold"
            style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
          />
          <Sliders className="w-5 h-5 text-neutral-400 ml-3 flex-shrink-0 cursor-pointer hover:text-white transition" />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex space-x-3 overflow-x-auto pb-2 scrollbar-none">
        {['All', 'Playlists', 'Downloads', 'Favorites', 'Recently Played'].map((cat) => {
          const isActive = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                borderRadius: '999px',
                padding: '8px 18px',
                fontSize: '14px',
                border: 'none',
                cursor: 'pointer',
                flexShrink: 0,
                backgroundColor: isActive ? '#1DB954' : 'rgba(255, 255, 255, 0.05)',
                color: isActive ? '#000000' : '#ffffff',
                fontWeight: isActive ? '700' : '600',
                transition: 'all 0.2s ease',
              }}
              className={`${isActive ? 'shadow-[0_4px_14px_rgba(29,185,84,0.3)]' : 'hover:bg-white/10'}`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Content Rendering switcher */}
      {renderCategoryContent()}

      {/* Floating Action Button */}
      <button
        onClick={handleCreatePlaylist}
        className="fixed bottom-[110px] right-[24px] w-14 h-14 rounded-full bg-[#1DB954] text-black shadow-[0_8px_24px_rgba(29,185,84,0.4)] hover:shadow-[0_12px_30px_rgba(29,185,84,0.6)] flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-300 z-40 cursor-pointer border-none"
        aria-label="Create New Playlist"
      >
        <Plus className="w-8 h-8 text-black font-black" />
      </button>
    </div>
  );
}

// --- General Playlist / Album View ---
function PlaylistPage() {
  const { state, dispatch, showToast, playTrackGlobally } = useApp();
  const playlist = state.currentViewData;
  const [loading, setLoading] = useState(false);
  const [hydratedPlaylist, setHydratedPlaylist] = useState(null);

  const isUserCreated = playlist?.id && playlist.id.toString().startsWith('playlist_');

  const fetchPlaylistData = async () => {
    if (!playlist) return;
    if (isUserCreated) {
      // Load user-created playlist details directly from state
      const synced = state.playlists.find(p => p.id === playlist.id);
      setHydratedPlaylist(synced);
      return;
    }

    // Otherwise fetch JioSaavn playlist details
    try {
      setLoading(true);
      const res = await apiFetch(`/playlists?id=${playlist.id}`);
      if (res && res.songs) {
        res.songs = res.songs.map(s => ({ ...s, isFresh: true }));
      }
      setHydratedPlaylist(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylistData();
  }, [playlist, state.playlists]);

  const handlePlaySong = (index) => {
    if (!hydratedPlaylist || !hydratedPlaylist.songs) return;
    playTrackGlobally(hydratedPlaylist.songs, index);
  };

  const handleDelete = () => {
    if (confirm("Delete this playlist?")) {
      dispatch({ type: 'DELETE_PLAYLIST', payload: playlist.id });
      showToast("Playlist deleted");
    }
  };

  if (loading) return <PlaylistSkeleton />;
  if (!hydratedPlaylist) return <div className="p-6 text-neutral-400">Playlist not found.</div>;

  const songs = hydratedPlaylist.songs || [];
  const imageUrl = getImageUrl(hydratedPlaylist, 2) || null;

  return (
    <div className="pb-32">
      {/* Playlist header */}
      <div className="bg-gradient-to-b from-[#7c3aed] to-[#121212] px-6 pt-12 pb-6 flex flex-col md:flex-row items-end space-y-4 md:space-y-0 md:space-x-6">
        <div className="w-48 h-48 rounded bg-neutral-800 flex items-center justify-center flex-shrink-0 shadow-2xl relative overflow-hidden group">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music className="w-16 h-16 text-neutral-600" />
          )}
        </div>
        <div className="space-y-2">
          <span className="text-xs uppercase tracking-wider font-bold text-neutral-200">Playlist</span>
          <h1 className="text-4xl md:text-5xl font-black text-white">{decodeHtml(hydratedPlaylist.name)}</h1>
          <p className="text-xs text-neutral-300 line-clamp-2">{decodeHtml(hydratedPlaylist.description)}</p>
          <div className="text-xs text-neutral-400 flex items-center space-x-2">
            <span className="text-white font-semibold">
              {isUserCreated ? 'You' : (hydratedPlaylist.artists?.[0]?.name || hydratedPlaylist.author || 'Spotify')}
            </span>
            <span className="w-1 h-1 rounded-full bg-neutral-600" />
            <span>{songs.length} songs</span>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Actions bar */}
        <div className="flex items-center space-x-6">
          {songs.length > 0 && (
            <button
              className="w-14 h-14 bg-[#1db954] hover:scale-105 transition rounded-full flex items-center justify-center shadow-md cursor-pointer"
              onClick={() => handlePlaySong(0)}
              aria-label="Play playlist"
            >
              <Play className="w-6 h-6 text-black fill-black ml-0.5" />
            </button>
          )}
          {isUserCreated && (
            <button
              className="px-4 py-2 border border-neutral-700 hover:border-white text-xs font-semibold rounded-full uppercase tracking-wider text-white transition flex items-center space-x-1.5"
              onClick={handleDelete}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Playlist</span>
            </button>
          )}
        </div>

        {/* Songs List */}
        <div className="space-y-1">
          {songs.length === 0 ? (
            <div className="text-neutral-500 text-sm py-12 text-center">This playlist is empty. Search for songs to add them!</div>
          ) : (
            <SongsListTable songs={songs} onPlaySong={handlePlaySong} playlistId={isUserCreated ? playlist.id : null} />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Album View ---
function AlbumPage() {
  const { state, dispatch, playTrackGlobally } = useApp();
  const album = state.currentViewData;
  const [loading, setLoading] = useState(false);
  const [hydratedAlbum, setHydratedAlbum] = useState(null);

  const fetchAlbumData = async () => {
    if (!album) return;
    try {
      setLoading(true);
      const res = await apiFetch(`/albums?id=${album.id}`);
      if (res && res.songs) {
        res.songs = res.songs.map(s => ({ ...s, isFresh: true }));
      }
      setHydratedAlbum(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlbumData();
  }, [album]);

  const handlePlaySong = (index) => {
    if (!hydratedAlbum || !hydratedAlbum.songs) return;
    playTrackGlobally(hydratedAlbum.songs, index);
  };

  if (loading) return <PlaylistSkeleton />;
  if (!hydratedAlbum) return <div className="p-6 text-neutral-400">Album not found.</div>;

  const songs = hydratedAlbum.songs || [];
  const imageUrl = getImageUrl(hydratedAlbum, 2) || null;

  return (
    <div className="pb-32">
      <div className="bg-gradient-to-b from-[#c084fc] to-[#121212] px-6 pt-12 pb-6 flex flex-col md:flex-row items-end space-y-4 md:space-y-0 md:space-x-6">
        <div className="w-48 h-48 rounded bg-neutral-800 flex-shrink-0 shadow-2xl relative overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music className="w-16 h-16 text-neutral-600" />
          )}
        </div>
        <div className="space-y-2">
          <span className="text-xs uppercase tracking-wider font-bold text-neutral-200">Album</span>
          <h1 className="text-4xl md:text-5xl font-black text-white">{decodeHtml(hydratedAlbum.name)}</h1>
          <div className="text-xs text-neutral-400 flex items-center space-x-2">
            <span className="text-white font-semibold">{decodeHtml(getArtistName(hydratedAlbum))}</span>
            <span className="w-1 h-1 rounded-full bg-neutral-600" />
            <span>{hydratedAlbum.year || ''}</span>
            <span className="w-1 h-1 rounded-full bg-neutral-600" />
            <span>{songs.length} songs</span>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex items-center space-x-6">
          {songs.length > 0 && (
            <button
              className="w-14 h-14 bg-[#1db954] hover:scale-105 transition rounded-full flex items-center justify-center shadow-md cursor-pointer"
              onClick={() => handlePlaySong(0)}
              aria-label="Play album"
            >
              <Play className="w-6 h-6 text-black fill-black ml-0.5" />
            </button>
          )}
        </div>

        <div className="space-y-1">
          <SongsListTable songs={songs} onPlaySong={handlePlaySong} />
        </div>
      </div>
    </div>
  );
}

// --- Artist View ---
function ArtistPage() {
  const { state, dispatch, playTrackGlobally } = useApp();
  const artist = state.currentViewData;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ artistInfo: null, songs: [], albums: [] });

  const fetchArtistData = async () => {
    if (!artist) return;
    try {
      setLoading(true);
      // 1. Fetch artist details using v2 route format (?id=)
      const artistInfo = await apiFetch(`/artists?id=${artist.id}`);
      
      // 2. Fetch popular songs and albums by searching the artist's name
      const artistName = artistInfo?.name || artist.name;
      const [artistSongs, artistAlbums] = await Promise.all([
        apiFetch(`/search/songs?query=${encodeURIComponent(artistName)}&limit=20`),
        apiFetch(`/search/albums?query=${encodeURIComponent(artistName)}&limit=10`)
      ]);

      setData({
        artistInfo,
        songs: (artistSongs?.results || []).map(s => ({ ...s, isFresh: true })),
        albums: artistAlbums?.results || []
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArtistData();
  }, [artist]);

  const handlePlaySong = (index) => {
    if (data.songs.length === 0) return;
    playTrackGlobally(data.songs, index);
  };

  const handleAlbumClick = (albumItem) => {
    dispatch({ type: 'SET_VIEW', payload: { view: 'album', data: albumItem } });
  };

  if (loading) return <PlaylistSkeleton />;
  if (!data.artistInfo) return <div className="p-6 text-neutral-400">Artist info not loaded.</div>;

  const imageUrl = getImageUrl(data.artistInfo, 2) || null;

  return (
    <div className="pb-32">
      {/* Hero Header Banner */}
      <div
        className="h-60 md:h-72 bg-cover bg-center relative flex items-end p-6"
        style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.2), rgba(18,18,18,0.95)), url(${imageUrl || 'https://placehold.co/600x300'})` }}
      >
        <div className="space-y-1">
          <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Verified Artist</span>
          <h1 className="text-4xl md:text-6xl font-black text-white truncate">{decodeHtml(data.artistInfo.name)}</h1>
          <p className="text-xs text-neutral-300 font-semibold">{data.artistInfo.followers?.toLocaleString() || '1,245,670'} followers</p>
        </div>
      </div>

      <div className="p-6 space-y-10">
        {/* Play Action button */}
        <div className="flex items-center space-x-6">
          {data.songs.length > 0 && (
            <button
              className="w-14 h-14 bg-[#1db954] hover:scale-105 transition rounded-full flex items-center justify-center shadow-md cursor-pointer"
              onClick={() => handlePlaySong(0)}
              aria-label="Play artist hits"
            >
              <Play className="w-6 h-6 text-black fill-black ml-0.5" />
            </button>
          )}
        </div>

        {/* Popular Songs */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-white">Popular Songs</h2>
          <SongsListTable songs={data.songs.slice(0, 5)} onPlaySong={handlePlaySong} />
        </section>

        {/* Albums */}
        {data.albums.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-white">Albums</h2>
            <div className="flex space-x-4 overflow-x-auto pb-4">
              {data.albums.map((albumItem) => (
                <div
                  key={albumItem.id}
                  className="w-40 bg-[#1a1a1a] hover:bg-[#282828] p-4 rounded-lg flex-shrink-0 cursor-pointer transition duration-300 group"
                  onClick={() => handleAlbumClick(albumItem)}
                >
                  <div className="relative mb-3 pb-[100%] rounded overflow-hidden">
                    <img
                      src={albumItem.image?.[2]?.url || 'https://placehold.co/150'}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="font-semibold text-sm truncate text-white">{decodeHtml(albumItem.name)}</h3>
                  <span className="text-xs text-neutral-400 mt-1 block">Album • {albumItem.year}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// --- Liked Songs Screen ---
function LikedSongsPage() {
  const { state, dispatch, showToast, setContextMenu, playTrackGlobally } = useApp();
  const [scrollOpacity, setScrollOpacity] = useState(0);

  useEffect(() => {
    const scrollEl = document.querySelector('.flex-1.overflow-y-auto');
    if (!scrollEl) return;
    
    const onScroll = () => {
      const opacity = Math.min(1, scrollEl.scrollTop / 100);
      setScrollOpacity(opacity);
    };
    
    scrollEl.addEventListener('scroll', onScroll);
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, []);

  const handlePlaySong = (index) => {
    if (state.likedSongs.length === 0) return;
    dispatch({ type: 'SET_QUEUE', payload: { songs: state.likedSongs, index } });
    dispatch({ type: 'SET_CURRENT_SONG', payload: state.likedSongs[index] });
    dispatch({ type: 'SET_PLAYING', payload: true });
  };

  const handleThreeDotClick = (e, song) => {
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: Math.min(window.innerWidth - 240, e.clientX - 180),
      y: Math.min(window.innerHeight - 360, e.clientY + 10),
      song,
      playlistId: null
    });
  };

  return (
    <div className="min-h-full bg-[#121212] pb-32 relative select-none">
      {/* 1. TOP HEADER BAR */}
      <div className="sticky top-0 z-30" style={{ height: '90px' }}>
        {/* Base Gradient Layer */}
        <div 
          className="absolute inset-0 transition-opacity duration-300"
          style={{
            background: 'linear-gradient(180deg, #3d4fa0 0%, #2a3580 60%, #121212 100%)',
            opacity: 1 - scrollOpacity
          }}
        />
        {/* Scroll Overlap Solid Layer */}
        <div 
          className="absolute inset-0 bg-[#121212] transition-opacity duration-300"
          style={{
            opacity: scrollOpacity
          }}
        />
        
        {/* Content */}
        <div className="relative z-10 flex items-center justify-between h-full px-5 py-4">
          <button 
            onClick={() => window.history.back()}
            className="text-white cursor-pointer hover:scale-105 active:scale-95 transition"
            aria-label="Back"
          >
            <ArrowLeft size={26} color="#fff" />
          </button>
          
          <h1 className="text-xl font-bold text-white">Liked Songs</h1>
          
          <div className="w-[26px]" />
        </div>

        {/* Floating Play Button */}
        {state.likedSongs.length > 0 && (
          <button
            onClick={() => handlePlaySong(0)}
            className="absolute bottom-[-26px] right-5 w-[52px] h-[52px] rounded-full bg-[#1DB954] flex items-center justify-center shadow-[0_4px_16px_rgba(29,185,84,0.3)] hover:scale-105 active:scale-95 transition-all duration-200 z-40 cursor-pointer border-none"
          >
            <Play className="w-5 h-5 fill-black text-black translate-x-[1px]" />
          </button>
        )}
      </div>

      {state.likedSongs.length === 0 ? (
        /* 4. EMPTY STATE */
        <div className="flex flex-col items-center justify-center text-center px-6 py-28 text-[#b3b3b3]">
          <Heart className="w-16 h-16 text-[#b3b3b3] mb-4 opacity-50 fill-none" />
          <h3 className="text-lg font-bold text-white mb-2">Songs you like will appear here</h3>
          <button
            onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'search' } })}
            className="mt-4 px-6 py-3 rounded-full bg-[#FFFFFF] hover:bg-neutral-200 text-black text-sm font-bold transition shadow-md cursor-pointer border-none"
          >
            Browse Music
          </button>
        </div>
      ) : (
        <div className="pt-8">
          {/* 6. SONG COUNT SUBHEADER */}
          <div className="text-[13px] text-[#b3b3b3] px-4 pb-2 font-semibold">
            {state.likedSongs.length} songs
          </div>

          {/* 2. SONG LIST */}
          <div className="space-y-0">
            {state.likedSongs.map((song, index) => {
              const isCurrent = state.currentSong && state.currentSong.id === song.id;
              
              return (
                <div
                  key={song.id || index}
                  onClick={() => handlePlaySong(index)}
                  className="flex items-center px-4 py-2.5 gap-3 hover:bg-[#1a1a1a] transition cursor-pointer select-none"
                  style={{ backgroundColor: '#121212' }}
                >
                  {/* Album Art */}
                  <img
                    src={getImageUrl(song, 1)}
                    alt=""
                    className="w-14 h-14 object-cover rounded shadow-md flex-shrink-0"
                    style={{ borderRadius: '4px' }}
                  />

                  {/* Song Title and Artist */}
                  <div className="flex-grow min-w-0 pr-2">
                    <p 
                      className="font-semibold text-white truncate"
                      style={{ 
                        fontSize: '15px', 
                        color: isCurrent ? '#1DB954' : '#fff',
                        maxWidth: 'calc(100vw - 120px)'
                      }}
                    >
                      {isCurrent && <span className="text-[#1DB954]">... </span>}
                      {decodeHtml(song.name || song.title)}
                    </p>
                    <p 
                      className="text-neutral-400 truncate mt-0.5"
                      style={{ 
                        fontSize: '13px', 
                        color: '#b3b3b3',
                        fontWeight: '400'
                      }}
                    >
                      {decodeHtml(getArtistName(song))}
                    </p>
                  </div>

                  {/* Context menu action */}
                  <button
                    onClick={(e) => handleThreeDotClick(e, song)}
                    className="w-10 h-10 hover:bg-white/5 rounded-full flex items-center justify-center flex-shrink-0 text-[#b3b3b3] hover:text-white transition cursor-pointer border-none bg-transparent"
                  >
                    <MoreVertical size={24} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Downloaded Offline Songs Screen ---
function DownloadedSongsPage() {
  const { state, dispatch, showToast } = useApp();

  const handlePlaySong = (index) => {
    if (state.downloadedSongs.length === 0) return;
    // Map downloaded IndexedDB rawSong back to playable structure
    const tracks = state.downloadedSongs.map(s => s.rawSong || s);
    dispatch({ type: 'SET_QUEUE', payload: { songs: tracks, index } });
    dispatch({ type: 'SET_CURRENT_SONG', payload: tracks[index] });
    dispatch({ type: 'SET_PLAYING', payload: true });
  };

  const handleRemoveDownload = async (id, e) => {
    e.stopPropagation();
    if (confirm("Delete download from offline store?")) {
      await deleteDownload(id);
      const updated = await getAllDownloads();
      dispatch({ type: 'SET_DOWNLOADS', payload: updated });
      showToast("Download deleted");
    }
  };

  return (
    <div className="pb-32">
      <div className="bg-gradient-to-b from-[#065f46] to-[#121212] px-6 pt-16 pb-6 flex flex-col md:flex-row items-end space-y-4 md:space-y-0 md:space-x-6">
        <div className="w-48 h-48 rounded bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center flex-shrink-0 shadow-2xl relative">
          <Download className="w-20 h-20 text-white" />
        </div>
        <div className="space-y-2">
          <span className="text-xs uppercase tracking-wider font-bold text-neutral-200">Playlist</span>
          <h1 className="text-4xl md:text-5xl font-black text-white">Downloaded</h1>
          <div className="text-xs text-neutral-400 flex items-center space-x-2">
            <span className="text-white font-semibold">Offline Store</span>
            <span className="w-1 h-1 rounded-full bg-neutral-600" />
            <span>{state.downloadedSongs.length} tracks offline</span>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {state.downloadedSongs.length > 0 && (
          <div className="flex items-center space-x-6">
            <button
              className="w-14 h-14 bg-[#1db954] hover:scale-105 transition rounded-full flex items-center justify-center shadow-md cursor-pointer"
              onClick={() => handlePlaySong(0)}
              aria-label="Play offline tracks"
            >
              <Play className="w-6 h-6 text-black fill-black ml-0.5" />
            </button>
          </div>
        )}

        <div className="space-y-1">
          {state.downloadedSongs.length === 0 ? (
            <div className="text-neutral-500 py-20 text-center flex flex-col items-center justify-center space-y-3">
              <Download className="w-12 h-12 text-neutral-700" />
              <p className="text-sm">Download songs to listen offline without internet.</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-900 bg-[#121212] rounded-lg">
              {state.downloadedSongs.map((song, index) => (
                <div
                  key={song.id}
                  className="flex items-center justify-between p-2.5 hover:bg-neutral-800/50 rounded-md cursor-pointer group"
                  onClick={() => handlePlaySong(index)}
                >
                  <div className="flex items-center space-x-4 overflow-hidden">
                    <span className="text-xs text-neutral-400 w-4 text-right flex-shrink-0 group-hover:hidden">{index + 1}</span>
                    <Play className="w-4 h-4 text-white hidden group-hover:block flex-shrink-0" />

                    <div className="w-10 h-10 bg-neutral-800 rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {song.imageBlob ? (
                        <img src={URL.createObjectURL(song.imageBlob)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Music className="w-5 h-5 text-neutral-600" />
                      )}
                    </div>
                    <div className="overflow-hidden">
                      <p className="font-semibold text-sm text-white truncate">{decodeHtml(song.name)}</p>
                      <p className="text-xs text-neutral-400 truncate">{decodeHtml(song.artists)}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 pr-2 flex-shrink-0">
                    <span className="text-xs text-neutral-400">{formatTime(song.duration)}</span>
                    <button
                      className="text-neutral-500 hover:text-red-500 transition"
                      onClick={(e) => handleRemoveDownload(song.id, e)}
                      aria-label="Remove offline download"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Dynamic Playlist Table Row list ---
function SongsListTable({ songs, onPlaySong, playlistId }) {
  const { state, dispatch, showToast, activeDownloads, setActiveDownloads, setContextMenu } = useApp();

  const isLiked = (song) => state.likedSongs.some(s => s.id === song.id);
  const isDownloaded = (song) => state.downloadedSongs.some(s => s.id === song.id);

  const toggleHeart = (song, e) => {
    e.stopPropagation();
    dispatch({ type: 'TOGGLE_LIKE', payload: song });
    showToast(isLiked(song) ? "Removed from Liked Songs" : "Added to Liked Songs ✓");
  };

  const handleDownload = async (song, e) => {
    e.stopPropagation();
    if (isDownloaded(song)) {
      if (confirm("Delete offline download?")) {
        await deleteDownload(song.id);
        const updated = await getAllDownloads();
        dispatch({ type: 'SET_DOWNLOADS', payload: updated });
        showToast("Download deleted");
      }
      return;
    }

    try {
      showToast(`Downloading... ${decodeHtml(song.name || song.title)}`, 'info');
      setActiveDownloads(prev => ({ ...prev, [song.id]: 10 }));

      // Fetch blobs & save in IndexedDB
      await downloadSong(song, state.audioQuality);

      // Hydrate local cache list in Redux State
      const updated = await getAllDownloads();
      dispatch({ type: 'SET_DOWNLOADS', payload: updated });

      setActiveDownloads(prev => {
        const u = { ...prev };
        delete u[song.id];
        return u;
      });
      showToast("Download complete! ✓");
    } catch (err) {
      setActiveDownloads(prev => {
        const u = { ...prev };
        delete u[song.id];
        return u;
      });
      showToast("Download failed. CORS block.", 'error');
    }
  };

  const handleRowContextMenu = (e, song) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: Math.min(window.innerWidth - 240, e.clientX),
      y: Math.min(window.innerHeight - 360, e.clientY),
      song,
      playlistId
    });
  };

  const handleThreeDotClick = (e, song) => {
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: Math.min(window.innerWidth - 240, e.clientX - 180),
      y: Math.min(window.innerHeight - 360, e.clientY + 10),
      song,
      playlistId
    });
  };

  return (
    <div className="w-full text-left border-collapse select-none">
      <div className="grid grid-cols-12 gap-2 text-xs text-neutral-400 uppercase tracking-wider font-semibold border-b border-neutral-800 pb-2 px-4 mb-2">
        <span className="col-span-1 text-center">#</span>
        <span className="col-span-6 md:col-span-7">Title</span>
        <span className="col-span-3 md:col-span-2 hidden sm:block">Album</span>
        <span className="col-span-2 text-right">Actions</span>
      </div>

      <div className="divide-y divide-neutral-900 bg-[#121212] rounded-md">
        {songs.map((song, i) => {
          const liked = isLiked(song);
          const dl = isDownloaded(song);
          const dling = activeDownloads[song.id] !== undefined;

          return (
            <div
              key={song.id || i}
              className="grid grid-cols-12 gap-2 items-center p-2.5 hover:bg-neutral-800/60 rounded-md cursor-pointer group"
              onClick={() => onPlaySong(i)}
              onContextMenu={(e) => handleRowContextMenu(e, song)}
            >
              {/* Index Column */}
              <div className="col-span-1 flex items-center justify-center flex-shrink-0">
                <span className="text-xs text-neutral-400 group-hover:hidden w-4 text-center">{i + 1}</span>
                <Play className="w-4 h-4 text-white hidden group-hover:block ml-0.5" />
              </div>

              {/* Title & Artist */}
              <div className="col-span-6 md:col-span-7 flex items-center space-x-3 overflow-hidden">
                <img
                  src={getImageUrl(song, 1)}
                  alt=""
                  className="w-10 h-10 rounded object-cover flex-shrink-0"
                />
                <div className="overflow-hidden">
                  <p className="font-semibold text-sm text-white truncate">{decodeHtml(song.name || song.title)}</p>
                  <p className="text-xs text-neutral-400 truncate">
                    {decodeHtml(getArtistName(song))}
                  </p>
                </div>
              </div>

              {/* Album Column */}
              <div className="col-span-3 md:col-span-2 text-xs text-neutral-400 truncate hidden sm:block">
                {decodeHtml(song.album?.name || song.album || '')}
              </div>

              {/* Action Buttons */}
              <div className="col-span-2 flex items-center justify-end space-x-3 pr-2">
                {/* Heart Button */}
                <button
                  onClick={(e) => toggleHeart(song, e)}
                  className="text-neutral-400 hover:text-white transition cursor-pointer"
                  aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
                >
                  <Heart className={`w-4 h-4 ${liked ? 'text-[#1db954] fill-[#1db954]' : ''}`} />
                </button>

                {/* Download Button */}
                <button
                  onClick={(e) => handleDownload(song, e)}
                  disabled={dling}
                  className="text-neutral-400 hover:text-white transition cursor-pointer"
                  aria-label={dl ? "Remove download" : "Download song"}
                >
                  {dling ? (
                    <div className="w-4 h-4 border-2 border-t-transparent border-[#1db954] rounded-full animate-spin" />
                  ) : dl ? (
                    <Check className="w-4 h-4 text-[#1db954]" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </button>

                {/* Three Dots Button */}
                <button
                  onClick={(e) => handleThreeDotClick(e, song)}
                  className="text-neutral-400 hover:text-white transition cursor-pointer"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContextMenu({ x, y, song, playlistId, onClose }) {
  const { state, dispatch, showToast, activeDownloads, setActiveDownloads } = useApp();
  const [showSubmenu, setShowSubmenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const clickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', clickOutside);
    return () => document.removeEventListener('mousedown', clickOutside);
  }, []);

  if (!song) return null;

  const isLiked = state.likedSongs.some(s => s.id === song.id);
  const isDownloaded = state.downloadedSongs.some(s => s.id === song.id);

  const handlePlayNow = () => {
    dispatch({ type: 'SET_QUEUE', payload: { songs: [song], index: 0 } });
    dispatch({ type: 'SET_CURRENT_SONG', payload: song });
    dispatch({ type: 'SET_PLAYING', payload: true });
    onClose();
  };

  const handleAddToQueue = () => {
    dispatch({ type: 'SET_QUEUE', payload: { songs: [...state.queue, song], index: state.queueIndex } });
    showToast("Added to Queue");
    onClose();
  };

  const handleToggleLike = () => {
    dispatch({ type: 'TOGGLE_LIKE', payload: song });
    showToast(isLiked ? "Removed from Liked" : "Added to Liked Songs ✓");
    onClose();
  };

  const handleDownloadToggle = async () => {
    onClose();
    if (isDownloaded) {
      if (confirm("Delete offline download?")) {
        await deleteDownload(song.id);
        const updated = await getAllDownloads();
        dispatch({ type: 'SET_DOWNLOADS', payload: updated });
        showToast("Download deleted");
      }
      return;
    }
    try {
      showToast(`Downloading... ${decodeHtml(song.name || song.title)}`, 'info');
      setActiveDownloads(prev => ({ ...prev, [song.id]: 10 }));
      await downloadSong(song, state.audioQuality);
      const updated = await getAllDownloads();
      dispatch({ type: 'SET_DOWNLOADS', payload: updated });
      setActiveDownloads(prev => {
        const u = { ...prev };
        delete u[song.id];
        return u;
      });
      showToast("Download complete! ✓");
    } catch {
      setActiveDownloads(prev => {
        const u = { ...prev };
        delete u[song.id];
        return u;
      });
      showToast("Download failed. CORS block.", 'error');
    }
  };

  const handleShare = () => {
    const dummyUrl = `https://saavn.dev/api/songs?id=${song.id}`;
    navigator.clipboard.writeText(dummyUrl).then(() => {
      showToast("Link copied to clipboard");
    }).catch(() => {
      showToast("Failed to copy link", "error");
    });
    onClose();
  };

  const handleAddToPlaylist = (plId) => {
    dispatch({
      type: 'ADD_TO_PLAYLIST',
      payload: { playlistId: plId, song }
    });
    const pl = state.playlists.find(p => p.id === plId);
    showToast(`Added to ${pl?.name || 'Playlist'}`);
    onClose();
  };

  const handleGoToArtist = () => {
    const art = song.artists?.primary?.[0] || { id: song.artistId, name: song.artists };
    dispatch({ type: 'SET_VIEW', payload: { view: 'artist', data: art } });
    onClose();
  };

  const handleGoToAlbum = () => {
    const alb = song.album || { id: song.albumId, name: song.album };
    dispatch({ type: 'SET_VIEW', payload: { view: 'album', data: alb } });
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ top: `${y}px`, left: `${x}px` }}
      className="fixed bg-[#282828] text-white border border-neutral-800 rounded shadow-2xl p-1 w-56 z-[100] space-y-0.5 text-xs font-semibold select-none animate-fade-in"
    >
      <button onClick={handlePlayNow} className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center space-x-2">
        <Play className="w-3.5 h-3.5" />
        <span>Play now</span>
      </button>
      <button onClick={handleAddToQueue} className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center space-x-2">
        <ListMusic className="w-3.5 h-3.5" />
        <span>Add to queue</span>
      </button>

      <div className="relative">
        <button
          onMouseEnter={() => setShowSubmenu(true)}
          className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <Plus className="w-3.5 h-3.5" />
            <span>Add to playlist</span>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
        </button>

        {showSubmenu && (
          <div
            onMouseLeave={() => setShowSubmenu(false)}
            className="absolute left-full top-0 bg-[#282828] border border-neutral-800 rounded shadow-2xl p-1 w-48 space-y-0.5"
          >
            {state.playlists.length === 0 ? (
              <p className="text-[10px] text-neutral-500 italic p-2">No playlists created</p>
            ) : (
              state.playlists.map(pl => (
                <button
                  key={pl.id}
                  onClick={() => handleAddToPlaylist(pl.id)}
                  className="w-full text-left py-1.5 px-3 hover:bg-neutral-700/60 transition rounded truncate"
                >
                  {pl.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <button onClick={handleGoToArtist} className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center space-x-2">
        <User className="w-3.5 h-3.5" />
        <span>Go to artist</span>
      </button>
      <button onClick={handleGoToAlbum} className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center space-x-2">
        <Music className="w-3.5 h-3.5" />
        <span>Go to album</span>
      </button>
      <button onClick={handleShare} className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center space-x-2">
        <Share2 className="w-3.5 h-3.5" />
        <span>Share</span>
      </button>
      <button onClick={handleDownloadToggle} className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center space-x-2">
        <Download className="w-3.5 h-3.5" />
        <span>{isDownloaded ? 'Delete offline copy' : 'Download'}</span>
      </button>
      <button onClick={handleToggleLike} className="w-full text-left py-2 px-3 hover:bg-neutral-700/60 transition rounded flex items-center space-x-2 border-t border-neutral-800/80 mt-1">
        <Heart className="w-3.5 h-3.5" />
        <span>{isLiked ? 'Remove from Liked' : 'Add to Liked'}</span>
      </button>
    </div>
  );
}

// ==========================================
// 6. Navigation Context Menu & Queue Panel
// ==========================================
function QueuePanel({ isOpen, onClose }) {
  const { state, dispatch } = useApp();

  if (!isOpen) return null;

  const currentIdx = state.queueIndex;
  const nowPlaying = state.queue[currentIdx];
  const upcoming = state.queue.slice(currentIdx + 1);

  const handlePlayNow = (queueIndex) => {
    dispatch({ type: 'SET_QUEUE_INDEX', payload: queueIndex });
    dispatch({ type: 'SET_CURRENT_SONG', payload: state.queue[queueIndex] });
    dispatch({ type: 'SET_PLAYING', payload: true });
  };

  return (
    <div className="fixed right-0 top-0 bottom-[90px] w-80 bg-[#121212] border-l border-neutral-900 shadow-2xl z-40 flex flex-col animate-slide-in">
      <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
        <h2 className="font-bold text-lg text-white">Play Queue</h2>
        <button onClick={onClose} className="text-neutral-400 hover:text-white cursor-pointer" aria-label="Close Queue">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-grow overflow-y-auto p-4 space-y-6">
        {/* Now Playing */}
        <div className="space-y-3">
          <h3 className="text-xs uppercase tracking-wider font-bold text-neutral-400">Now Playing</h3>
          {nowPlaying ? (
            <div className="flex items-center space-x-3 bg-neutral-900 p-2 rounded-md">
              <img
                src={getImageUrl(nowPlaying, 1)}
                alt=""
                className="w-10 h-10 rounded object-cover flex-shrink-0"
              />
              <div className="overflow-hidden">
                <p className="font-semibold text-sm text-[#1db954] truncate">{decodeHtml(nowPlaying.name || nowPlaying.title)}</p>
                <p className="text-xs text-neutral-400 truncate">
                  {decodeHtml(getArtistName(nowPlaying))}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500 italic">No song active</p>
          )}
        </div>

        {/* Up Next */}
        <div className="space-y-3">
          <h3 className="text-xs uppercase tracking-wider font-bold text-neutral-400">Next In Queue</h3>
          {upcoming.length > 0 ? (
            <div className="space-y-1.5">
              {upcoming.map((song, i) => {
                const targetIdx = currentIdx + 1 + i;
                return (
                  <div
                    key={song.id || targetIdx}
                    className="flex items-center space-x-3 p-2 hover:bg-neutral-800/40 rounded-md cursor-pointer group"
                    onClick={() => handlePlayNow(targetIdx)}
                  >
                    <img
                      src={getImageUrl(song, 1)}
                      alt=""
                      className="w-9 h-9 rounded object-cover flex-shrink-0"
                    />
                    <div className="overflow-hidden flex-grow">
                      <p className="font-semibold text-xs text-white truncate">{decodeHtml(song.name || song.title)}</p>
                      <p className="text-[10px] text-neutral-400 truncate">
                        {decodeHtml(getArtistName(song))}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-neutral-500 italic">Queue is empty</p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Layout Container ---
export default function App() {
  return (
    <AppProvider>
      <AppContainer />
    </AppProvider>
  );
}

function AppContainer() {
  const { state, dispatch, toasts, showToast, contextMenu, setContextMenu, audioRef, playTrackGlobally } = useApp();
  const [queueOpen, setQueueOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sleepTimerActive, setSleepTimerActive] = useState(null); // time remaining or null
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [homeFilter, setHomeFilter] = useState('all'); // 'all' | 'music' | 'podcasts'
  const activeObjectUrlRef = useRef(null);

  // Clean up Object URL to prevent leaks
  const cleanActiveUrl = () => {
    if (audioRef.current.activeObjectUrl) {
      URL.revokeObjectURL(audioRef.current.activeObjectUrl);
      audioRef.current.activeObjectUrl = null;
    }
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
  };

  // Sync state variables directly with Audio element
  useEffect(() => {
    audioRef.current.volume = state.muted ? 0 : state.volume;
  }, [state.volume, state.muted]);

  // Handle Playback State Transitions
  useEffect(() => {
    if (state.isPlaying) {
      if (audioRef.current.src && audioRef.current.src !== window.location.href) {
        const isSilentWav = audioRef.current.src.startsWith('data:');
        audioRef.current.play().catch(err => {
          if (err.name !== 'AbortError') {
            console.warn("Autoplay blocked or stream fail:", err);
            if (!isSilentWav) {
              dispatch({ type: 'SET_PLAYING', payload: false });
            }
          }
        });
      }
    } else {
      audioRef.current.pause();
    }
  }, [state.isPlaying]);

  // Load Source URL and play
  const playTrack = async (song) => {
    try {
      if (audioRef.current.currentSongId === song.id && 
          audioRef.current.src && 
          !audioRef.current.src.startsWith('data:') && 
          audioRef.current.src !== window.location.href) {
        if (state.isPlaying && audioRef.current.paused) {
          audioRef.current.play().catch(() => {});
        }
        return;
      }

      audioRef.current.currentSongId = song.id;
      cleanActiveUrl();
      // Check offline IndexedDB blob synchronously from state cache first
      const dbRecord = state.downloadedSongs?.find(s => s.id === song.id);
      let sourceUrl;
      let fullSong = song;
      if (dbRecord && dbRecord.audioBlob) {
        sourceUrl = URL.createObjectURL(dbRecord.audioBlob);
        activeObjectUrlRef.current = sourceUrl;
        audioRef.current.activeObjectUrl = sourceUrl;
      } else {
        if (!song.isFresh || !song.downloadUrl || song.downloadUrl.length === 0) {
          try {
            const detailRes = await apiFetch(`/songs?id=${song.id}`);
            if (detailRes && detailRes.length > 0) {
              fullSong = { ...detailRes[0], isFresh: true };
              dispatch({ type: 'SET_CURRENT_SONG', payload: fullSong });
              const updatedQueue = state.queue.map(s => s.id === song.id ? fullSong : s);
              dispatch({ type: 'SET_QUEUE', payload: { songs: updatedQueue, index: state.queueIndex } });
              return;
            }
          } catch (fetchErr) {
            console.error("Failed to fetch full song details:", fetchErr);
          }
        }
        sourceUrl = getAudioUrlByQuality(fullSong, state.audioQuality);
      }

      if (!sourceUrl) throw new Error("Audio URL unresolved");

      audioRef.current.src = sourceUrl;
      audioRef.current.load();
      if (state.isPlaying) {
        audioRef.current.play().catch(err => {
          if (err.name !== 'AbortError') {
            dispatch({ type: 'SET_PLAYING', payload: false });
          }
        });
      }

      // Sync OS Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: decodeHtml(fullSong.name || fullSong.title),
          artist: decodeHtml(getArtistName(fullSong)),
          album: decodeHtml(fullSong.album?.name || fullSong.album || ''),
          artwork: [{ src: getImageUrl(fullSong, 2) }]
        });
      }
    } catch (err) {
      console.error(err);
      showToast("Streaming failed. CORS error.", "error");
      dispatch({ type: 'SET_PLAYING', payload: false });
    }
  };

  useEffect(() => {
    if (state.currentSong) {
      playTrack(state.currentSong);
    }
  }, [state.currentSong]);

  // Setup audio engine listeners
  useEffect(() => {
    const audio = audioRef.current;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      // Simple 3s Cross-fade fadeout
      const total = audio.duration;
      if (total && total - audio.currentTime <= 3) {
        const remaining = total - audio.currentTime;
        const ratio = Math.max(0, remaining / 3);
        audio.volume = state.muted ? 0 : state.volume * ratio;
      } else {
        audio.volume = state.muted ? 0 : state.volume;
      }
    };

    const handleDurationChange = () => {
      setDuration(audio.duration || 0);
    };

    const handleProgress = () => {
      if (audio.buffered.length > 0) {
        setBufferedTime(audio.buffered.end(audio.buffered.length - 1));
      }
    };

    const handleEnded = () => {
      if (audioRef.current.src && audioRef.current.src.startsWith('data:')) {
        return;
      }
      nextSong();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('progress', handleProgress);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('progress', handleProgress);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [state.queue, state.queueIndex, state.repeat, state.shuffle, state.volume, state.muted]);

  // Media Session listeners
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => dispatch({ type: 'SET_PLAYING', payload: true }));
      navigator.mediaSession.setActionHandler('pause', () => dispatch({ type: 'SET_PLAYING', payload: false }));
      navigator.mediaSession.setActionHandler('nexttrack', () => nextSong());
      navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
    }
  }, [state.queue, state.queueIndex, state.shuffle]);

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying });
          break;
        case 'm':
        case 'M':
          dispatch({ type: 'SET_MUTED', payload: !state.muted });
          break;
        case 'ArrowRight':
          if (e.shiftKey) {
            nextSong();
          } else {
            audioRef.current.currentTime = Math.min(duration, currentTime + 10);
          }
          break;
        case 'ArrowLeft':
          if (e.shiftKey) {
            prevSong();
          } else {
            audioRef.current.currentTime = Math.max(0, currentTime - 10);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isPlaying, state.muted, currentTime, duration, state.queue, state.queueIndex]);

  // Queue traversal operations
  const nextSong = () => {
    if (state.queue.length === 0) return;

    if (state.repeat === 'one') {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }

    let nextIdx = state.queueIndex + 1;
    if (state.shuffle) {
      nextIdx = Math.floor(Math.random() * state.queue.length);
    } else if (nextIdx >= state.queue.length) {
      if (state.repeat === 'all') {
        nextIdx = 0;
      } else {
        // Trigger Artist Radio if queue finishes
        triggerArtistRadio();
        return;
      }
    }

    dispatch({ type: 'SET_QUEUE_INDEX', payload: nextIdx });
    dispatch({ type: 'SET_CURRENT_SONG', payload: state.queue[nextIdx] });
    dispatch({ type: 'SET_PLAYING', payload: true });
  };

  const prevSong = () => {
    if (state.queue.length === 0) return;

    if (audioRef.current.currentTime > 4) {
      audioRef.current.currentTime = 0;
      return;
    }

    let prevIdx = state.queueIndex - 1;
    if (prevIdx < 0) {
      if (state.repeat === 'all') {
        prevIdx = state.queue.length - 1;
      } else {
        prevIdx = 0;
      }
    }

    dispatch({ type: 'SET_QUEUE_INDEX', payload: prevIdx });
    dispatch({ type: 'SET_CURRENT_SONG', payload: state.queue[prevIdx] });
    dispatch({ type: 'SET_PLAYING', payload: true });
  };

  // Artist Radio fallback
  const triggerArtistRadio = async () => {
    const current = state.currentSong;
    if (!current) return;
    const artistName = current.artists?.primary?.[0]?.name || current.artists || '';
    if (!artistName) return;

    try {
      showToast(`Entering ${artistName} Radio mode...`, 'info');
      const radioTracks = await apiFetch(`/search/songs?query=${encodeURIComponent(artistName)}&limit=15`);
      const results = radioTracks?.results || [];
      if (results.length > 0) {
        dispatch({ type: 'SET_QUEUE', payload: { songs: results, index: 0 } });
        dispatch({ type: 'SET_CURRENT_SONG', payload: results[0] });
        dispatch({ type: 'SET_PLAYING', payload: true });
      }
    } catch {
      showToast("Radio mode unavailable.", 'error');
    }
  };

  // Load IndexedDB cache offline list at startup
  useEffect(() => {
    const syncOffline = async () => {
      const dbSongs = await getAllDownloads();
      dispatch({ type: 'SET_DOWNLOADS', payload: dbSongs });
    };
    syncOffline();
  }, []);

  // Sleep Timer countdown
  useEffect(() => {
    if (!sleepTimerActive) return;
    const interval = setInterval(() => {
      setSleepTimerActive(prev => {
        if (prev <= 1) {
          dispatch({ type: 'SET_PLAYING', payload: false });
          showToast("Sleep timer triggered. Playback stopped.");
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 60000); // Decrement every minute
    return () => clearInterval(interval);
  }, [sleepTimerActive]);

  // Dynamic router view renderer
  const renderView = () => {
    switch (state.currentView) {
      case 'home':
        return <HomePage />;
      case 'search':
        return <SearchPage />;
      case 'library':
        return <LibraryPage />;
      case 'playlist':
        return <PlaylistPage />;
      case 'album':
        return <AlbumPage />;
      case 'artist':
        return <ArtistPage />;
      case 'liked':
        return <LikedSongsPage />;
      case 'downloaded':
        return <DownloadedSongsPage />;
      default:
        return <HomePage />;
    }
  };

  const currentPercentage = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPercentage = duration ? (bufferedTime / duration) * 100 : 0;

  const handleProgressBarClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = (clickX / rect.width) * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeBarClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newVolume = Math.min(1, Math.max(0, clickX / rect.width));
    dispatch({ type: 'SET_VOLUME', payload: newVolume });
  };

  const toggleMuted = () => {
    dispatch({ type: 'SET_MUTED', payload: !state.muted });
  };

  const toggleRepeat = () => {
    let nextRepeat = 'off';
    if (state.repeat === 'off') nextRepeat = 'all';
    else if (state.repeat === 'all') nextRepeat = 'one';
    dispatch({ type: 'SET_REPEAT', payload: nextRepeat });
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#121212] text-white">
      {/* 3-Panel Main Workspace layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar Left Panel (Desktop: 240px wide, Tablet: 72px icons only, Mobile: hidden) */}
        <aside className="w-[72px] md:w-60 bg-black flex-shrink-0 flex flex-col justify-between py-6 px-3 md:px-4 hidden sm:flex border-r border-neutral-900/60 z-30">
          <div className="space-y-8">
            {/* Logo branding */}
            <div
              className="flex items-center space-x-2 px-2 cursor-pointer"
              onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'home' } })}
            >
              <div className="w-8 h-8 rounded-full bg-[#1db954] flex items-center justify-center">
                <Music className="w-5 h-5 text-black" />
              </div>
              <span className="font-black text-xl hidden md:inline text-white tracking-tighter">Spotify</span>
            </div>

            {/* Links */}
            <nav className="space-y-4">
              <button
                className={`flex items-center space-x-4 w-full px-2 py-1 text-sm font-semibold transition cursor-pointer ${
                  state.currentView === 'home' ? 'text-white' : 'text-neutral-400 hover:text-white'
                }`}
                onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'home' } })}
              >
                <HomeIcon className="w-6 h-6 flex-shrink-0" />
                <span className="hidden md:inline">Home</span>
              </button>
              <button
                className={`flex items-center space-x-4 w-full px-2 py-1 text-sm font-semibold transition cursor-pointer ${
                  state.currentView === 'search' ? 'text-white' : 'text-neutral-400 hover:text-white'
                }`}
                onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'search' } })}
              >
                <SearchIcon className="w-6 h-6 flex-shrink-0" />
                <span className="hidden md:inline">Search</span>
              </button>
              <button
                className={`flex items-center space-x-4 w-full px-2 py-1 text-sm font-semibold transition cursor-pointer ${
                  state.currentView === 'library' ? 'text-white' : 'text-neutral-400 hover:text-white'
                }`}
                onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'library' } })}
              >
                <LibraryIcon className="w-6 h-6 flex-shrink-0" />
                <span className="hidden md:inline">Your Library</span>
              </button>
            </nav>

            <div className="border-t border-neutral-900 pt-4 space-y-4">
              <button
                className="flex items-center space-x-4 w-full px-2 py-1 text-xs font-bold text-neutral-400 hover:text-white transition uppercase tracking-wider cursor-pointer"
                onClick={() => {
                  const name = prompt("Enter playlist name:");
                  if (name) dispatch({ type: 'CREATE_PLAYLIST', payload: { name } });
                }}
              >
                <Plus className="w-5 h-5 flex-shrink-0" />
                <span className="hidden md:inline">Create Playlist</span>
              </button>
              <button
                className={`flex items-center space-x-4 w-full px-2 py-1 text-xs font-bold transition uppercase tracking-wider cursor-pointer ${
                  state.currentView === 'liked' ? 'text-[#1db954]' : 'text-neutral-400 hover:text-white'
                }`}
                onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'liked' } })}
              >
                <Heart className="w-5 h-5 flex-shrink-0 fill-current" />
                <span className="hidden md:inline">Liked Songs</span>
              </button>
              <button
                className={`flex items-center space-x-4 w-full px-2 py-1 text-xs font-bold transition uppercase tracking-wider cursor-pointer ${
                  state.currentView === 'downloaded' ? 'text-[#1db954]' : 'text-neutral-400 hover:text-white'
                }`}
                onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'downloaded' } })}
              >
                <Download className="w-5 h-5 flex-shrink-0" />
                <span className="hidden md:inline">Downloads</span>
              </button>
            </div>
          </div>

          {/* User profile details in sidebar bottom */}
          <div className="pt-6 border-t border-neutral-900">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center space-x-3 w-full px-2 py-1 text-xs text-neutral-400 hover:text-white cursor-pointer"
            >
              <SettingsIcon className="w-5 h-5 flex-shrink-0" />
              <span className="hidden md:inline font-bold uppercase tracking-wider">Settings</span>
            </button>
          </div>
        </aside>

        {/* Scrollable Main Content Frame */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#121212] overflow-hidden">
          {/* Top Bar Header with profile tools and back navigation */}
          {state.currentView === 'home' ? (
            <header 
              className="sticky top-0 z-10 flex-shrink-0 w-full flex items-center space-x-3"
              style={{
                backgroundColor: '#121212',
                padding: '16px',
              }}
            >
              <img
                src="https://i.ibb.co/qYcQqXrw/Picsart-26-06-03-08-58-56-505.png"
                alt="Profile"
                style={{
                  borderRadius: '50%',
                  width: '40px',
                  height: '40px',
                  objectFit: 'cover'
                }}
                className="cursor-pointer hover:opacity-90 transition flex-shrink-0"
                onClick={() => setSettingsOpen(true)}
              />
              <div className="flex space-x-2">
                <button
                  onClick={() => setHomeFilter('all')}
                  style={{
                    borderRadius: '999px',
                    padding: '8px 18px',
                    fontSize: '14px',
                    border: 'none',
                    cursor: 'pointer',
                    flexShrink: 0,
                    backgroundColor: homeFilter === 'all' ? '#1DB954' : '#2a2a2a',
                    color: homeFilter === 'all' ? '#000000' : '#ffffff',
                    fontWeight: homeFilter === 'all' ? 'bold' : '600'
                  }}
                  className="transition"
                >
                  All
                </button>
                <button
                  onClick={() => setHomeFilter('music')}
                  style={{
                    borderRadius: '999px',
                    padding: '8px 18px',
                    fontSize: '14px',
                    border: 'none',
                    cursor: 'pointer',
                    flexShrink: 0,
                    backgroundColor: homeFilter === 'music' ? '#1DB954' : '#2a2a2a',
                    color: homeFilter === 'music' ? '#000000' : '#ffffff',
                    fontWeight: homeFilter === 'music' ? 'bold' : '600'
                  }}
                  className="transition"
                >
                  Music
                </button>
                <button
                  onClick={() => setHomeFilter('podcasts')}
                  style={{
                    borderRadius: '999px',
                    padding: '8px 18px',
                    fontSize: '14px',
                    border: 'none',
                    cursor: 'pointer',
                    flexShrink: 0,
                    backgroundColor: homeFilter === 'podcasts' ? '#1DB954' : '#2a2a2a',
                    color: homeFilter === 'podcasts' ? '#000000' : '#ffffff',
                    fontWeight: homeFilter === 'podcasts' ? 'bold' : '600'
                  }}
                  className="transition"
                >
                  Podcasts
                </button>
              </div>
            </header>
          ) : state.currentView === 'search' ? (
            <header 
              className="sticky top-0 flex items-center z-10 flex-shrink-0 w-full"
              style={{
                backgroundColor: '#121212',
                padding: '16px'
              }}
            >
              <div className="relative w-full transition-transform duration-200 focus-within:scale-[1.01]">
                <div 
                  className="flex items-center w-full"
                  style={{ 
                    backgroundColor: '#FFFFFF',
                    borderRadius: '8px',
                    padding: '14px 16px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    border: 'none'
                  }}
                >
                  <Search size={20} color="#000" className="flex-shrink-0 mr-3" />
                  <input
                    type="text"
                    placeholder="What do you want to listen to?"
                    value={state.searchQuery}
                    onChange={(e) => dispatch({ type: 'SET_SEARCH_QUERY', payload: e.target.value })}
                    className="w-full bg-transparent text-black border-none focus:outline-none focus:ring-0 p-0 placeholder-[#9a9a9a] placeholder:font-semibold placeholder:text-[16px]"
                    style={{
                      fontWeight: '600',
                      fontSize: '16px',
                      border: 'none',
                      outline: 'none',
                      boxShadow: 'none'
                    }}
                  />
                  {state.searchQuery && (
                    <button
                      onClick={() => dispatch({ type: 'SET_SEARCH_QUERY', payload: '' })}
                      className="text-neutral-500 hover:text-black cursor-pointer ml-2 flex-shrink-0"
                      aria-label="Clear Search"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            </header>
          ) : state.currentView === 'library' ? null : (
            <header className="sticky top-0 bg-[#121212]/95 backdrop-blur-md px-6 py-4 flex items-center justify-between z-10 border-b border-neutral-900 flex-shrink-0">
              <div className="flex items-center flex-grow">
                <div className="flex space-x-2">
                  <button
                    className="w-8 h-8 rounded-full bg-black/70 flex items-center justify-center hover:bg-neutral-800 transition cursor-pointer text-white disabled:opacity-40"
                    aria-label="Back"
                    onClick={() => window.history.back()}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    className="w-8 h-8 rounded-full bg-black/70 flex items-center justify-center hover:bg-neutral-800 transition cursor-pointer text-white"
                    aria-label="Forward"
                    onClick={() => window.history.forward()}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center space-x-3 flex-shrink-0">
                {sleepTimerActive && (
                  <span className="text-[10px] uppercase font-bold text-amber-500 flex items-center space-x-1 border border-amber-500/40 rounded px-2 py-0.5 animate-pulse">
                    <span>Sleep: {sleepTimerActive}m</span>
                  </span>
                )}
                <div
                  className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center cursor-pointer border border-neutral-700 hover:border-white transition"
                  onClick={() => setSettingsOpen(true)}
                >
                  <User className="w-4 h-4 text-white" />
                </div>
              </div>
            </header>
          )}

          {/* Router content holder */}
          <div className="flex-1 overflow-y-auto">
            {renderView()}
          </div>
        </main>

        {/* Up Next Play Queue Panel drawer drawer */}
        <QueuePanel isOpen={queueOpen} onClose={() => setQueueOpen(false)} />
      </div>

      {/* Bottom Mini Player on Mobile (only below 768px screen width) */}
      {state.currentSong && (
        <div
          className="md:hidden bg-[#181818] mx-2 mb-2 p-2.5 rounded-lg flex items-center justify-between border border-neutral-900 shadow-xl cursor-pointer"
          onClick={() => setFullscreenOpen(true)}
        >
          <div className="flex items-center space-x-3 overflow-hidden pr-4 flex-grow">
            <img
              src={getImageUrl(state.currentSong, 1)}
              alt=""
              className="w-10 h-10 object-cover rounded shadow"
            />
            <div className="overflow-hidden">
              <p className="font-semibold text-xs text-white truncate">{decodeHtml(state.currentSong.name || state.currentSong.title)}</p>
              <p className="text-[10px] text-neutral-400 truncate">
                {decodeHtml(getArtistName(state.currentSong))}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying });
              }}
              className="w-8 h-8 bg-white rounded-full flex items-center justify-center"
              aria-label={state.isPlaying ? "Pause" : "Play"}
            >
              {state.isPlaying ? <Pause className="w-4 h-4 text-black fill-black" /> : <Play className="w-4 h-4 text-black fill-black ml-0.5" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                nextSong();
              }}
              className="text-white"
              aria-label="Next track"
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile Responsive Bottom Navigation Tab bar (Only below 640px) */}
      <nav className="sm:hidden h-14 bg-black border-t border-neutral-900 flex items-center justify-around z-30 flex-shrink-0">
        <button
          className={`flex flex-col items-center justify-center space-y-1 text-center flex-1 py-1 transition ${state.currentView === 'home' ? 'text-white' : 'text-neutral-500'}`}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'home' } })}
        >
          <HomeIcon className="w-5 h-5" />
          <span className="text-[9px] font-semibold">Home</span>
        </button>
        <button
          className={`flex flex-col items-center justify-center space-y-1 text-center flex-1 py-1 transition ${state.currentView === 'search' ? 'text-white' : 'text-neutral-500'}`}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'search' } })}
        >
          <SearchIcon className="w-5 h-5" />
          <span className="text-[9px] font-semibold">Search</span>
        </button>
        <button
          className={`flex flex-col items-center justify-center space-y-1 text-center flex-1 py-1 transition ${state.currentView === 'library' ? 'text-white' : 'text-neutral-500'}`}
          onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'library' } })}
        >
          <LibraryIcon className="w-5 h-5" />
          <span className="text-[9px] font-semibold">Library</span>
        </button>
      </nav>

      {/* Persistent Bottom Audio Player Bar (Desktop/Tablet) */}
      <footer className="h-[90px] bg-[#181818] border-t border-neutral-900/60 px-4 md:px-6 items-center justify-between hidden md:flex z-30 flex-shrink-0 select-none">
        {/* Left Side: Thumbnail metadata */}
        <div className="flex items-center space-x-4 w-1/4 min-w-[180px]">
          {state.currentSong ? (
            <>
              <div
                className="w-14 h-14 bg-neutral-800 rounded shadow-md overflow-hidden relative cursor-pointer group flex-shrink-0"
                onClick={() => setFullscreenOpen(true)}
              >
                <img src={getImageUrl(state.currentSong, 1)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                <div className="absolute inset-0 bg-black/40 items-center justify-center hidden group-hover:flex">
                  <Maximize2 className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="overflow-hidden">
                <div className="w-full overflow-hidden text-sm font-semibold text-white whitespace-nowrap">
                  <p className="truncate hover:underline cursor-pointer" onClick={() => setFullscreenOpen(true)}>
                    {decodeHtml(state.currentSong.name || state.currentSong.title)}
                  </p>
                </div>
                <p
                  className="text-xs text-neutral-400 truncate mt-0.5 hover:underline cursor-pointer"
                  onClick={() => dispatch({ type: 'SET_VIEW', payload: { view: 'artist', data: state.currentSong.artists?.primary?.[0] || { name: getArtistName(state.currentSong) } } })}
                >
                  {decodeHtml(getArtistName(state.currentSong))}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center space-x-3">
              <div className="w-14 h-14 bg-neutral-800 rounded flex items-center justify-center flex-shrink-0">
                <Music className="w-6 h-6 text-neutral-600" />
              </div>
              <p className="text-xs text-neutral-500 italic">No track selected</p>
            </div>
          )}
        </div>

        {/* Center: Controls & Seeking slider progress bar */}
        <div className="flex flex-col items-center flex-grow max-w-[500px] w-2/4 px-4 space-y-2">
          {/* Controls button row */}
          <div className="flex items-center space-x-5">
            <button
              onClick={() => dispatch({ type: 'TOGGLE_SHUFFLE' })}
              className={`transition cursor-pointer ${state.shuffle ? 'text-[#1db954] hover:text-[#1ed760]' : 'text-neutral-400 hover:text-white'}`}
              aria-label="Toggle Shuffle"
            >
              <Shuffle className="w-4 h-4" />
            </button>
            <button onClick={prevSong} className="text-neutral-400 hover:text-white transition cursor-pointer" aria-label="Previous track">
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying })}
              className="w-8 h-8 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition shadow cursor-pointer flex-shrink-0"
              aria-label={state.isPlaying ? "Pause" : "Play"}
            >
              {state.isPlaying ? <Pause className="w-4 h-4 fill-black text-black" /> : <Play className="w-4 h-4 fill-black text-black ml-0.5" />}
            </button>
            <button onClick={nextSong} className="text-neutral-400 hover:text-white transition cursor-pointer" aria-label="Next track">
              <SkipForward className="w-5 h-5 fill-current" />
            </button>
            <button
              onClick={toggleRepeat}
              className={`transition cursor-pointer relative ${state.repeat !== 'off' ? 'text-[#1db954] hover:text-[#1ed760]' : 'text-neutral-400 hover:text-white'}`}
              aria-label="Toggle Repeat"
            >
              <Repeat className="w-4 h-4" />
              {state.repeat === 'one' && (
                <span className="absolute -top-1.5 -right-1.5 text-[7px] font-black bg-[#1db954] text-black w-3 h-3 rounded-full flex items-center justify-center">1</span>
              )}
            </button>
          </div>

          {/* Slider Progress seek bar */}
          <div className="flex items-center space-x-2 w-full text-xs text-neutral-400">
            <span>{formatTime(currentTime)}</span>
            <div
              className="relative flex-grow h-1.5 rounded-full bg-neutral-800 cursor-pointer overflow-hidden group"
              onClick={handleProgressBarClick}
            >
              {/* Buffered progress indicator */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-neutral-700 transition-all duration-300"
                style={{ width: `${bufferedPercentage}%` }}
              />
              {/* Current track progress indicator */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-white group-hover:bg-[#1db954] transition-all"
                style={{ width: `${currentPercentage}%` }}
              />
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right Side: Utilities volume seeker / full-screen toggle */}
        <div className="flex items-center justify-end space-x-4 w-1/4 min-w-[180px]">
          <button
            onClick={() => setQueueOpen(!queueOpen)}
            className={`transition cursor-pointer ${queueOpen ? 'text-[#1db954]' : 'text-neutral-400 hover:text-white'}`}
            aria-label="Toggle Queue Panel"
          >
            <ListMusic className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <button onClick={toggleMuted} className="text-neutral-400 hover:text-white transition cursor-pointer" aria-label={state.muted ? "Unmute" : "Mute"}>
              {state.muted ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <div
              className="w-20 h-1 rounded-full bg-neutral-800 relative cursor-pointer group"
              onClick={handleVolumeBarClick}
            >
              <div
                className="absolute left-0 top-0 bottom-0 bg-white group-hover:bg-[#1db954]"
                style={{ width: `${state.muted ? 0 : state.volume * 100}%` }}
              />
            </div>
          </div>
          <button
            onClick={() => setFullscreenOpen(true)}
            className="text-neutral-400 hover:text-white transition cursor-pointer"
            aria-label="Enter Full Screen Player"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* ==========================================
          7. Modals (Settings & Full Screen Overlays)
          ========================================== */}

      {/* Settings Dialog Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#1a1a1a] rounded-lg w-full max-w-md p-6 relative border border-neutral-800 shadow-2xl">
            <button
              onClick={() => setSettingsOpen(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white cursor-pointer"
              aria-label="Close settings"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center space-x-2">
              <SettingsIcon className="w-5 h-5" />
              <span>Settings</span>
            </h2>

            <div className="space-y-6 text-sm">
              {/* Audio Streaming Quality */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider font-bold text-neutral-400 block">Streaming / Download Quality</label>
                <select
                  value={state.audioQuality}
                  onChange={(e) => {
                    dispatch({ type: 'SET_QUALITY', payload: e.target.value });
                    showToast(`Quality updated to ${e.target.value}`);
                  }}
                  className="w-full bg-[#242424] text-white px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-[#1db954]"
                >
                  <option value="low">Low (96kbps - Save data)</option>
                  <option value="normal">Normal (160kbps)</option>
                  <option value="high">High (320kbps - Best sound)</option>
                </select>
              </div>

              {/* Sleep timer dropdown options */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider font-bold text-neutral-400 block">Sleep Timer</label>
                <select
                  onChange={(e) => {
                    const min = parseInt(e.target.value);
                    if (min === 0) {
                      setSleepTimerActive(null);
                      showToast("Sleep timer disabled");
                    } else {
                      setSleepTimerActive(min);
                      showToast(`Sleep timer set for ${min} minutes`);
                    }
                  }}
                  className="w-full bg-[#242424] text-white px-3 py-2 rounded focus:outline-none"
                >
                  <option value="0">Off</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>

              {/* Memory deletion actions */}
              <div className="space-y-3 pt-4 border-t border-neutral-900">
                <button
                  onClick={async () => {
                    if (confirm("Delete all offline downloaded files from your device?")) {
                      await clearAllDownloads();
                      dispatch({ type: 'SET_DOWNLOADS', payload: [] });
                      showToast("Offline downloads cleared");
                    }
                  }}
                  className="w-full text-left py-2 px-3 hover:bg-red-950/20 text-red-400 hover:text-red-300 transition rounded font-semibold text-xs uppercase tracking-wider block"
                >
                  Clear Device Downloads Cache
                </button>
                <button
                  onClick={() => {
                    if (confirm("Clear local listening logs and history?")) {
                      dispatch({ type: 'CLEAR_HISTORY' });
                      showToast(" listening logs cleared");
                    }
                  }}
                  className="w-full text-left py-2 px-3 hover:bg-neutral-800 transition rounded text-neutral-300 text-xs uppercase tracking-wider font-semibold block"
                >
                  Clear Listening History
                </button>
                <button
                  onClick={() => {
                    if (confirm("Log out? All cache logs and playlists will be wiped.")) {
                      dispatch({ type: 'LOG_OUT' });
                      setSettingsOpen(false);
                      showToast("Logged out");
                    }
                  }}
                  className="w-full text-left py-2 px-3 hover:bg-neutral-800 transition text-amber-500 rounded text-xs uppercase tracking-wider font-semibold flex items-center space-x-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Wipe All Local Data (Log Out)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Blur Canvas Player Overlay */}
      {fullscreenOpen && state.currentSong && (() => {
        const alreadyLiked = state.likedSongs.some(s => s.id === state.currentSong.id);
        const handlePlusClick = () => {
          if (!alreadyLiked) {
            dispatch({ type: 'TOGGLE_LIKE', payload: state.currentSong });
            showToast("Added to Liked Songs ✓");
          } else {
            showToast("Already in Liked Songs");
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex flex-col justify-between p-6 text-white overflow-hidden select-none animate-slide-up">
            {/* Full screen background: blurred album art */}
            <div 
              className="absolute inset-0 bg-cover bg-center pointer-events-none transition-all duration-500"
              style={{
                backgroundImage: `url(${getImageUrl(state.currentSong, 2)})`,
                filter: 'blur(80px) brightness(0.35) saturate(1.4)',
                transform: 'scale(1.2)',
                zIndex: 0
              }}
            />
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/40 z-0 pointer-events-none" />

            {/* 1. TOP BAR */}
            <div 
              className="relative z-10 flex items-center justify-between px-4 py-3 rounded-xl shadow-lg mt-2 flex-shrink-0"
              style={{ backgroundColor: '#2a2829' }}
            >
              <button
                onClick={() => setFullscreenOpen(false)}
                className="text-white cursor-pointer hover:scale-105 active:scale-95 transition"
                aria-label="Minimize full screen player"
              >
                <ChevronDown size={28} color="#fff" />
              </button>
              
              <div className="text-center overflow-hidden flex-grow px-4">
                <p className="text-[11px] text-[#b3b3b3] uppercase tracking-[1.5px] font-semibold truncate">
                  PLAYING FROM YOUR LIBRARY
                </p>
                <p className="text-[14px] font-bold text-white truncate mt-0.5">
                  {state.currentViewData?.name || state.currentViewData?.title || "Your Library"}
                </p>
              </div>

              <button className="text-white cursor-pointer hover:scale-105 active:scale-95 transition">
                <MoreVertical size={24} color="#fff" />
              </button>
            </div>

            {/* 2. ALBUM ART */}
            <div className="relative z-10 flex-grow flex items-center justify-center px-6 my-4">
              <div 
                className="w-full max-w-[340px] aspect-square overflow-hidden relative flex-shrink-0"
                style={{
                  boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                  borderRadius: '12px'
                }}
              >
                <img 
                  src={getImageUrl(state.currentSong, 2)} 
                  alt="" 
                  className="w-full h-full object-cover" 
                />
              </div>
            </div>

            {/* 3. SONG INFO ROW */}
            <div className="relative z-10 flex items-center justify-between px-6 flex-shrink-0">
              <div className="overflow-hidden flex-grow pr-4">
                <h2 
                  className="font-extrabold text-white truncate"
                  style={{ fontSize: '22px', fontWeight: '800' }}
                >
                  {decodeHtml(state.currentSong.name || state.currentSong.title)}
                </h2>
                <p 
                  className="truncate mt-1"
                  style={{ fontSize: '14px', color: '#b3b3b3', fontWeight: '500' }}
                >
                  {decodeHtml(getArtistName(state.currentSong))}
                </p>
              </div>
              <button 
                onClick={handlePlusClick} 
                className="cursor-pointer hover:scale-105 active:scale-95 transition flex-shrink-0"
                aria-label="Add to Liked"
              >
                {alreadyLiked ? (
                  <CheckCircle size={32} color="#1DB954" className="text-[#1DB954]" />
                ) : (
                  <PlusCircle size={32} color="#fff" />
                )}
              </button>
            </div>

            {/* 4. PROGRESS BAR */}
            <div className="relative z-10 px-6 w-full space-y-2 flex-shrink-0 mt-4">
              <input
                type="range"
                min="0"
                max={duration || 1}
                value={currentTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  audioRef.current.currentTime = val;
                  setCurrentTime(val);
                }}
                className="w-full h-1 bg-[#4a4a4a] rounded-lg appearance-none cursor-pointer accent-white [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:h-0 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white hover:[&::-webkit-slider-thumb]:w-2.5 hover:[&::-webkit-slider-thumb]:h-2.5 active:[&::-webkit-slider-thumb]:w-2.5 active:[&::-webkit-slider-thumb]:h-2.5 [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:h-0 hover:[&::-moz-range-thumb]:w-2.5 hover:[&::-moz-range-thumb]:h-2.5 active:[&::-moz-range-thumb]:w-2.5 active:[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:rounded-full transition-all duration-150"
                style={{
                  background: `linear-gradient(to right, #fff 0%, #fff ${currentPercentage}%, #4a4a4a ${currentPercentage}%, #4a4a4a 100%)`
                }}
              />
              <div className="flex items-center justify-between text-xs" style={{ fontSize: '12px', color: '#b3b3b3' }}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* 5. CONTROLS ROW */}
            <div className="relative z-10 flex items-center justify-between px-6 pb-8 pt-4 flex-shrink-0">
              {/* Shuffle */}
              <div className="flex flex-col items-center justify-center w-12">
                <button
                  onClick={() => dispatch({ type: 'TOGGLE_SHUFFLE' })}
                  className="cursor-pointer transition-colors"
                  style={{ color: state.shuffle ? '#1DB954' : '#b3b3b3' }}
                >
                  <Shuffle size={26} />
                </button>
                <div 
                  className="w-1 h-1 rounded-full mt-1 transition-opacity duration-200"
                  style={{ 
                    backgroundColor: '#1DB954', 
                    opacity: state.shuffle ? 1 : 0 
                  }} 
                />
              </div>

              {/* Skip Back */}
              <button onClick={prevSong} className="cursor-pointer text-white hover:scale-105 active:scale-95 transition flex items-center justify-center">
                <SkipBack size={36} fill="#fff" color="#fff" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={() => dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying })}
                className="w-[72px] h-[72px] bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-2xl cursor-pointer flex-shrink-0"
                aria-label={state.isPlaying ? "Pause" : "Play"}
              >
                {state.isPlaying ? (
                  <Pause size={28} color="#000" className="fill-current text-black" />
                ) : (
                  <Play size={28} color="#000" className="fill-current text-black translate-x-[2px]" />
                )}
              </button>

              {/* Skip Forward */}
              <button onClick={nextSong} className="cursor-pointer text-white hover:scale-105 active:scale-95 transition flex items-center justify-center">
                <SkipForward size={36} fill="#fff" color="#fff" />
              </button>

              {/* Repeat */}
              <div className="flex flex-col items-center justify-center w-12">
                <button
                  onClick={toggleRepeat}
                  className="cursor-pointer transition-colors"
                  style={{ color: state.repeat !== 'off' ? '#1DB954' : '#b3b3b3' }}
                >
                  <Repeat size={26} />
                </button>
                <div 
                  className="w-1.5 h-1.5 rounded-full mt-1.5 transition-opacity duration-200"
                  style={{ 
                    backgroundColor: '#1DB954', 
                    opacity: state.repeat !== 'off' ? 1 : 0 
                  }} 
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Context Menu Overlay */}
      {contextMenu.visible && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          song={contextMenu.song}
          playlistId={contextMenu.playlistId}
          onClose={() => setContextMenu({ ...contextMenu, visible: false })}
        />
      )}

      {/* Floating Animated Toast Notifications */}
      <div className="fixed top-4 right-4 z-[60] space-y-3 pointer-events-none select-none max-w-sm w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-3.5 rounded-lg shadow-2xl flex items-center space-x-2 text-xs font-semibold uppercase tracking-wider animate-slide-in pointer-events-auto ${
              toast.type === 'error'
                ? 'bg-red-950/90 text-red-200 border border-red-500/40'
                : toast.type === 'info'
                ? 'bg-neutral-900/90 text-amber-500 border border-amber-500/30'
                : 'bg-[#181818]/95 text-white border border-neutral-800'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-4.5 h-4.5 text-red-400" />
            ) : toast.type === 'info' ? (
              <CloudLightning className="w-4.5 h-4.5 text-amber-500 animate-bounce" />
            ) : (
              <Check className="w-4.5 h-4.5 text-[#1db954]" />
            )}
            <span className="flex-grow">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
