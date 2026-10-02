'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin,
  Navigation,
  Search,
  X,
  Check,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { geocodeAddress } from '../lib/mapService';

const HO_CENTER = { lat: 6.6008, lng: 0.4713 };
const GHANA_BOUNDS = [
  [4.5, -3.262],
  [11.173, 1.199],
];

function makePinIcon(draggable = false) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:24px;height:24px;border-radius:50% 50% 50% 0;
      background:#7a1d1d;border:3px solid white;
      transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      ${draggable ? 'cursor:move;' : ''}
    "><div style="
      width:12px;height:12px;border-radius:50%;
      background:white;position:absolute;
      top:50%;left:50%;transform:translate(-50%,-50%);
    "></div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
  });
}

export function LocationPicker({ initialPosition, onConfirm, onCancel }) {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markerRef = useRef(null);

  const [position, setPosition] = useState(initialPosition || HO_CENTER);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [locationError, setLocationError] = useState(null);

  useEffect(() => {
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      maxBounds: GHANA_BOUNDS,
      maxBoundsViscosity: 0.8,
    }).setView([position.lat, position.lng], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([position.lat, position.lng], {
      icon: makePinIcon(true),
      draggable: true,
    }).addTo(map);

    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng();
      setPosition({ lat, lng });
    });

    markerRef.current = marker;
    mapRef.current = map;

    return () => {
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      markerRef.current.setLatLng([position.lat, position.lng]);
      mapRef.current.setView([position.lat, position.lng], mapRef.current.getZoom());
    }
  }, [position.lat, position.lng]);

  const handleUseCurrentLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocationError('Location not available on this device');
      return;
    }

    setGettingLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newPos = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setPosition(newPos);
        if (mapRef.current) {
          mapRef.current.setView([newPos.lat, newPos.lng], 16);
        }
        setGettingLocation(false);
      },
      (err) => {
        setGettingLocation(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError('Location access denied. Enable location in your device settings.');
        } else if (err.code === err.TIMEOUT) {
          setLocationError('Location request timed out. Try again or search for a place.');
        } else {
          setLocationError('Could not get your location. Try searching for a place instead.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setSearching(true);
    setSearchError(null);

    try {
      const coords = await geocodeAddress(query);
      if (coords) {
        setPosition(coords);
        if (mapRef.current) {
          mapRef.current.setView([coords.lat, coords.lng], 16);
        }
        setSearchQuery('');
      } else {
        setSearchError('Place not found. Try a nearby landmark or city.');
      }
    } catch {
      setSearchError('Search failed. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleConfirm = useCallback(() => {
    onConfirm(position);
  }, [position, onConfirm]);

  return (
    <div className="fixed inset-0 bg-[#fefaf4] z-50 flex flex-col">
      <div className="px-4 pt-4 pb-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">Set your location</h2>
          <button
            onClick={onCancel}
            className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center active:scale-90 transition-transform"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search for a place, landmark, or area..."
              className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:border-[#7a1d1d]"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={!searchQuery.trim() || searching}
            className="px-4 py-2.5 bg-[#7a1d1d] text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Go'}
          </button>
        </div>

        <button
          onClick={handleUseCurrentLocation}
          disabled={gettingLocation}
          className="w-full flex items-center justify-center gap-2 bg-[#faf6ee] border border-gray-200 rounded-xl py-2.5 text-sm font-bold text-[#7a1d1d] active:scale-[0.99] transition-transform disabled:opacity-50"
        >
          {gettingLocation ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Getting your location...
            </>
          ) : (
            <>
              <Navigation className="w-4 h-4" />
              Use my current location
            </>
          )}
        </button>

        <AnimatePresence>
          {(searchError || locationError) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 bg-amber-50 text-amber-700 text-xs font-medium px-3 py-2 rounded-lg mt-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{searchError || locationError}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />
      </div>

      <div className="px-4 py-3 bg-white border-t border-gray-200">
        <p className="text-xs text-gray-600 mb-3 text-center">
          <MapPin className="w-3 h-3 inline mr-1" />
          Drag the pin to adjust your exact location
        </p>
        <button
          onClick={handleConfirm}
          className="w-full bg-[#7a1d1d] text-white py-3.5 rounded-xl font-bold text-base flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" />
          Confirm location
        </button>
      </div>
    </div>
  );
}
