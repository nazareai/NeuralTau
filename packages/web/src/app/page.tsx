'use client';

import { useEffect, useState, useRef } from 'react';
import type { GameState, GameAction, EmotionalState, EmotionType } from '@tau/shared';

// OBS Overlay modes
type OverlayMode = 'full' | 'overlay' | 'chat' | 'alerts' | 'stats';

function getOverlayMode(): OverlayMode {
  if (typeof window === 'undefined') return 'full';
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const widget = params.get('widget');
  if (mode === 'overlay') return 'overlay';
  if (widget === 'chat') return 'chat';
  if (widget === 'alerts') return 'alerts';
  if (widget === 'stats') return 'stats';
  return 'full';
}

interface Decision {
  reasoning: string;
  action: GameAction;
  gameState: GameState;
  timestamp: Date;
}

interface Result {
  action: GameAction;
  outcome: string;
  newState: GameState;
  timestamp: Date;
}

// Emoji mapping for emotions
const EMOTION_EMOJIS: Record<EmotionType, string> = {
  joy: '😊',
  frustration: '😤',
  anger: '😠',
  curiosity: '🤔',
  fear: '😰',
  satisfaction: '😌',
  boredom: '😑',
  excitement: '🤩',
  determination: '💪',
};

// Color mapping for emotions
const EMOTION_COLORS: Record<EmotionType, string> = {
  joy: '#4ADE80',
  frustration: '#F97316',
  anger: '#EF4444',
  curiosity: '#60A5FA',
  fear: '#A855F7',
  satisfaction: '#22D3EE',
  boredom: '#6B7280',
  excitement: '#FBBF24',
  determination: '#F472B6',
};

// Avatar sprite mapping based on emotion
const AVATAR_SPRITES: Record<string, string> = {
  neutral: '/avatar/neutral.png',
  normal: '/avatar/normal.png',
  joy: '/avatar/smile.png',
  excitement: '/avatar/smile.png',
  satisfaction: '/avatar/smile.png',
  curiosity: '/avatar/thinking.png',
  thinking: '/avatar/thinking.png',
  boredom: '/avatar/boredom.png',
  frustration: '/avatar/frustration.png',
  anger: '/avatar/frustration.png',
  fear: '/avatar/fear.png',
  determination: '/avatar/normal.png',
  dead: '/avatar/dead.png',
};

// Talking animation frames
const TALKING_FRAMES = [
  '/avatar/talking-slightly.png',
  '/avatar/talking-open.png',
  '/avatar/talking-wide.png',
  '/avatar/talking-open.png',
];

// Matrix Rain Effect Component
function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const chars = 'τΔΣΩαβγδ01'.split('');
    const fontSize = 12;
    const columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(columns).fill(1);

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#00ff4488';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(char, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const interval = setInterval(draw, 50);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity: 0.3,
        pointerEvents: 'none',
      }}
    />
  );
}

// Avatar Component
function Avatar({ 
  emotion, 
  isSpeaking, 
  isThinking,
  isDead 
}: { 
  emotion: EmotionType | null; 
  isSpeaking: boolean;
  isThinking: boolean;
  isDead: boolean;
}) {
  const [glowIntensity, setGlowIntensity] = useState(0.5);
  const [talkingFrame, setTalkingFrame] = useState(0);

  // Pulsing glow effect
  useEffect(() => {
    const interval = setInterval(() => {
      setGlowIntensity(prev => {
        const target = isSpeaking ? 0.9 : 0.5;
        return prev + (target - prev) * 0.1 + (Math.random() - 0.5) * 0.1;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [isSpeaking]);

  // Talking animation - cycle through frames when speaking
  useEffect(() => {
    if (!isSpeaking) {
      setTalkingFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setTalkingFrame(prev => (prev + 1) % TALKING_FRAMES.length);
    }, 120); // ~8 FPS for natural talking
    return () => clearInterval(interval);
  }, [isSpeaking]);

  // Determine which sprite to show
  const getSprite = () => {
    // Dead state takes priority over everything
    if (isDead) return AVATAR_SPRITES.dead;
    // When speaking, use talking animation frames
    if (isSpeaking) return TALKING_FRAMES[talkingFrame];
    if (isThinking) return AVATAR_SPRITES.thinking;
    if (emotion && AVATAR_SPRITES[emotion]) return AVATAR_SPRITES[emotion];
    return AVATAR_SPRITES.neutral;
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: 'linear-gradient(180deg, rgba(0, 20, 0, 0.95) 0%, rgba(0, 10, 0, 0.98) 100%)',
      borderRadius: '4px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Matrix Rain Background */}
      <MatrixRain />

      {/* Glow backdrop */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '80%',
        height: '80%',
        background: `radial-gradient(ellipse, rgba(74, 222, 128, ${glowIntensity * 0.3}) 0%, transparent 70%)`,
        filter: 'blur(20px)',
        transition: 'opacity 0.3s ease',
      }} />

      {/* Character Container */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        animation: isSpeaking 
          ? 'avatarTalk 0.15s ease-in-out infinite alternate'
          : 'avatarIdle 3s ease-in-out infinite',
        transformOrigin: 'center bottom',
      }}>
        {/* Character Image */}
        <img
          src={getSprite()}
          alt="NeuralTau Avatar"
          style={{
            width: '280px',
            height: 'auto',
            maxHeight: '320px',
            objectFit: 'contain',
            imageRendering: 'auto',
            filter: `drop-shadow(0 0 ${10 + glowIntensity * 20}px rgba(74, 222, 128, ${glowIntensity}))`,
            transition: 'filter 0.2s ease',
          }}
        />

        {/* Speaking indicator */}
        {isSpeaking && (
          <div style={{
            position: 'absolute',
            bottom: '-10px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '4px',
          }}>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#4ADE80',
                  animation: `speakingDot 0.6s ease-in-out infinite`,
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Thinking indicator */}
      {isThinking && (
        <div style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(0,0,0,0.7)',
          padding: '8px 12px',
          borderRadius: '4px',
          border: '2px solid #4ADE80',
        }}>
          <div style={{
            width: '12px',
            height: '12px',
            border: '2px solid #4ADE80',
            borderTop: '2px solid transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <span style={{
            fontSize: '8px',
            fontFamily: '"Press Start 2P", monospace',
            color: '#4ADE80',
          }}>
            THINKING
          </span>
        </div>
      )}

      {/* Corner tech decorations */}
      <div style={{
        position: 'absolute',
        top: '8px',
        left: '8px',
        width: '20px',
        height: '20px',
        borderLeft: '3px solid #4ADE80',
        borderTop: '3px solid #4ADE80',
        opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        width: '20px',
        height: '20px',
        borderRight: '3px solid #4ADE80',
        borderTop: '3px solid #4ADE80',
        opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        width: '20px',
        height: '20px',
        borderLeft: '3px solid #4ADE80',
        borderBottom: '3px solid #4ADE80',
        opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute',
        bottom: '8px',
        right: '8px',
        width: '20px',
        height: '20px',
        borderRight: '3px solid #4ADE80',
        borderBottom: '3px solid #4ADE80',
        opacity: 0.6,
      }} />
    </div>
  );
}

export default function Dashboard() {
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('full');
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [currentDecision, setCurrentDecision] = useState<Decision | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<'fast' | 'advanced'>('fast');
  const [emotionalState, setEmotionalState] = useState<EmotionalState | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isDead, setIsDead] = useState(false);
  const [testTimer, setTestTimer] = useState<{ active: boolean; startTime: number; duration: number }>({ active: false, startTime: 0, duration: 5 * 60 * 1000 }); // 5 minutes
  const [timerDisplay, setTimerDisplay] = useState('5:00');
  const [activity, setActivity] = useState<{ type: string; item?: string; active: boolean }>({ type: 'idle', active: false });
  const [heldItem, setHeldItem] = useState<{ name: string | null; displayName: string | null; action: 'idle' | 'mining' | 'attacking' | 'eating' | 'placing' }>({ name: null, displayName: null, action: 'idle' });
  const [viewerPort, setViewerPort] = useState(3007);
  const [itemPickups, setItemPickups] = useState<{ id: number; itemName: string; displayName: string; count: number }[]>([]);
  const [itemCrafts, setItemCrafts] = useState<{ id: number; itemName: string; displayName: string; count: number }[]>([]);
  const [streamerMessages, setStreamerMessages] = useState<{ id: number; text: string; type: string; timestamp: Date }[]>([]);
  
  // Viewer chat messages from Twitch
  const [viewerChat, setViewerChat] = useState<{
    id: string;
    username: string;
    displayName: string;
    message: string;
    platform: 'twitch' | 'x';
    badges: { subscriber?: boolean; moderator?: boolean; vip?: boolean; verified?: boolean };
    bits?: number;
    timestamp: Date;
  }[]>([]);
  
  // Donation/sub/raid alerts
  const [donationAlert, setDonationAlert] = useState<{
    type: 'subscription' | 'bits' | 'raid' | 'follow' | 'gift';
    username: string;
    displayName: string;
    amount?: number;
    message?: string;
    months?: number;
    giftCount?: number;
    viewerCount?: number;
  } | null>(null);
  
  const craftIdRef = useRef(0);
  const chatIdRef = useRef(0);
  
  // Session stats tracking
  const [sessionStats, setSessionStats] = useState({
    logsMined: 0,
    blocksMined: 0,
    itemsCrafted: 0,
    deaths: 0,
    startTime: Date.now(),
  });
  
  // Current objective tracking
  const [currentObjective, setCurrentObjective] = useState<{ text: string; progress: number; total: number } | null>(null);
  
  // Milestone celebration
  const [milestone, setMilestone] = useState<{ text: string; type: 'tool' | 'achievement' | 'death' } | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.10); // 10% volume for background music
  const [currentTrack, setCurrentTrack] = useState<string>('');
  const pickupIdRef = useRef(0);
  const messageIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const musicPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Audio playback function
  const playNextAudio = () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    const audioData = audioQueueRef.current.shift();
    if (!audioData) return;
    
    isPlayingRef.current = true;
    setIsSpeaking(true);
    
    try {
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.volume = 0.8;
      
      audio.play()
        .then(() => {
          console.log('[AUDIO] Playing streamer voice');
          setAudioEnabled(true);
        })
        .catch(e => {
          console.warn('[AUDIO] Autoplay blocked - click Enable Audio button:', e.message);
          isPlayingRef.current = false;
          setIsSpeaking(false);
          // Re-queue the audio for later
          audioQueueRef.current.unshift(audioData);
        });
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        console.log('[AUDIO] Playback finished');
        isPlayingRef.current = false;
        setIsSpeaking(false);
        playNextAudio(); // Play next in queue
      };
      
      audio.onerror = () => {
        console.error('[AUDIO] Audio error');
        isPlayingRef.current = false;
        setIsSpeaking(false);
        playNextAudio();
      };
    } catch (e) {
      console.error('[AUDIO] Failed to play audio:', e);
      isPlayingRef.current = false;
      setIsSpeaking(false);
    }
  };

  // Enable audio on user interaction
  const enableAudio = () => {
    const audio = new Audio();
    audio.play().catch(() => {});
    setAudioEnabled(true);
    playNextAudio();
  };

  // Music player - using a global audio element to avoid React closure issues
  const MUSIC_TRACKS = ['/music/1.mp3', '/music/2.mp3', '/music/3.mp3', '/music/4.mp3'];
  const musicIndexRef = useRef(0);

  const startMusic = () => {
    // Create fresh audio element each time
    if (musicPlayerRef.current) {
      musicPlayerRef.current.pause();
    }
    
    const audio = new Audio();
    audio.volume = musicVolume;
    
    const playTrack = (index: number) => {
      const track = MUSIC_TRACKS[index % MUSIC_TRACKS.length];
      console.log('[MUSIC] Playing:', track);
      audio.src = track;
      audio.play()
        .then(() => {
          console.log('[MUSIC] Started:', track);
          setCurrentTrack(track.split('/').pop() || '');
        })
        .catch((e) => console.error('[MUSIC] Failed:', e));
    };
    
    audio.onended = () => {
      musicIndexRef.current = (musicIndexRef.current + 1) % MUSIC_TRACKS.length;
      playTrack(musicIndexRef.current);
    };
    
    audio.onerror = () => {
      console.error('[MUSIC] Error, trying next');
      musicIndexRef.current = (musicIndexRef.current + 1) % MUSIC_TRACKS.length;
      playTrack(musicIndexRef.current);
    };
    
    musicPlayerRef.current = audio;
    
    // Start with random track
    musicIndexRef.current = Math.floor(Math.random() * MUSIC_TRACKS.length);
    playTrack(musicIndexRef.current);
    setMusicEnabled(true);
  };

  const stopMusic = () => {
    if (musicPlayerRef.current) {
      musicPlayerRef.current.pause();
      musicPlayerRef.current.src = '';
      musicPlayerRef.current = null;
    }
    setMusicEnabled(false);
    setCurrentTrack('');
  };

  // Update volume when slider changes
  useEffect(() => {
    if (musicPlayerRef.current) {
      musicPlayerRef.current.volume = musicVolume;
    }
  }, [musicVolume]);

  // Auto-start audio if ?autoplay=true in URL (for OBS)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autoplay') === 'true') {
      console.log('[AUTOPLAY] Auto-starting audio for OBS...');
      // Small delay to ensure page is loaded
      setTimeout(() => {
        // Enable voice
        const audio = new Audio();
        audio.play().catch(() => {});
        setAudioEnabled(true);
        
        // Start music
        startMusic();
      }, 2000);
    }
  }, []);

  // Set overlay mode from URL params (for OBS widgets)
  useEffect(() => {
    setOverlayMode(getOverlayMode());
    console.log('[OVERLAY] Mode:', getOverlayMode());
  }, []);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3002');

    ws.onopen = () => {
      console.log('Connected to Tau Bot');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'connected':
          // Get viewer port from server config
          if (message.config?.viewerPort) {
            setViewerPort(message.config.viewerPort);
          }
          break;

        case 'gameState':
          setGameState(message.data);
          break;

        case 'death':
          console.log('[WS] Death event received');
          setIsDead(true);
          break;

        case 'respawn':
          console.log('[WS] Respawn event received');
          setIsDead(false);
          break;

        case 'thinking':
          setIsThinking(message.data.isThinking);
          if (message.data.mode) {
            setThinkingMode(message.data.mode);
          }
          break;

        case 'decision':
          const decision = {
            ...message.data,
            timestamp: new Date(message.timestamp),
          };
          setCurrentDecision(decision);
          setDecisions(prev => [decision, ...prev].slice(0, 10));
          break;

        case 'result':
          const result = {
            ...message.data,
            timestamp: new Date(message.timestamp),
          };
          setResults(prev => [result, ...prev].slice(0, 10));
          break;

        case 'emotion':
          setEmotionalState(message.data);
          break;

        case 'activity':
          setActivity(message.data);
          break;

        case 'heldItem':
          setHeldItem(message.data);
          break;

        case 'itemPickup':
          // Add new pickup notification with unique ID
          const newPickup = {
            id: pickupIdRef.current++,
            itemName: message.data.itemName,
            displayName: message.data.displayName,
            count: message.data.count,
          };
          setItemPickups(prev => [...prev, newPickup]);
          // Remove after animation (2 seconds)
          setTimeout(() => {
            setItemPickups(prev => prev.filter(p => p.id !== newPickup.id));
          }, 2000);
          
          // Track session stats for logs/blocks
          if (message.data.itemName.includes('log')) {
            setSessionStats(prev => ({ ...prev, logsMined: prev.logsMined + message.data.count }));
          }
          setSessionStats(prev => ({ ...prev, blocksMined: prev.blocksMined + message.data.count }));
          break;

        case 'itemCraft':
          // Add new craft notification with unique ID
          const newCraft = {
            id: craftIdRef.current++,
            itemName: message.data.itemName,
            displayName: message.data.displayName,
            count: message.data.count,
          };
          setItemCrafts(prev => [...prev, newCraft]);
          // Remove after animation (2.5 seconds)
          setTimeout(() => {
            setItemCrafts(prev => prev.filter(c => c.id !== newCraft.id));
          }, 2500);
          
          // Track crafting stats
          setSessionStats(prev => ({ ...prev, itemsCrafted: prev.itemsCrafted + message.data.count }));
          
          // Detect tool milestones for celebration
          const toolMilestones = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 
                                   'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword',
                                   'crafting_table', 'furnace'];
          if (toolMilestones.includes(message.data.itemName)) {
            setMilestone({ text: `🎉 ${message.data.displayName.toUpperCase()}!`, type: 'tool' });
            setTimeout(() => setMilestone(null), 4000);
          }
          break;
        
        case 'milestone':
          // Server-sent milestone celebrations
          setMilestone({ text: message.data.text, type: message.data.type || 'achievement' });
          setTimeout(() => setMilestone(null), 4000);
          break;
        
        case 'death':
          // Track deaths
          setSessionStats(prev => ({ ...prev, deaths: prev.deaths + 1 }));
          setMilestone({ text: '💀 DIED!', type: 'death' });
          setTimeout(() => setMilestone(null), 4000);
          break;

        case 'streamerMessage':
          const newMessage = {
            id: messageIdRef.current++,
            text: message.data.text,
            type: message.data.type,
            timestamp: new Date(message.timestamp),
          };
          setStreamerMessages(prev => [newMessage, ...prev].slice(0, 20)); // Keep last 20
          break;

        case 'viewerChat':
          const chatMsg = {
            id: message.data.id || `chat-${chatIdRef.current++}`,
            username: message.data.username,
            displayName: message.data.displayName,
            message: message.data.message,
            platform: message.data.platform,
            badges: message.data.badges || {},
            bits: message.data.bits,
            timestamp: new Date(message.timestamp),
          };
          setViewerChat(prev => [...prev, chatMsg].slice(-50)); // Keep last 50
          break;

        case 'donationAlert':
          // Show big flashy alert
          setDonationAlert(message.data);
          // Auto-dismiss after duration based on type
          const duration = message.data.type === 'raid' ? 8000 
            : message.data.type === 'bits' ? (message.data.amount >= 1000 ? 10000 : 6000)
            : message.data.type === 'gift' ? 8000
            : 6000;
          setTimeout(() => setDonationAlert(null), duration);
          break;

        case 'audio':
          // Play audio from base64
          console.log('[AUDIO] Received audio data, length:', message.data.audio?.length);
          const audioData = message.data.audio;
          if (!audioData) {
            console.error('[AUDIO] No audio data received');
            break;
          }
          // Queue audio for playback
          audioQueueRef.current.push(audioData);
          playNextAudio();
          break;
      }
    };

    ws.onclose = () => {
      console.log('Disconnected');
      setConnected(false);
    };

    wsRef.current = ws;
    return () => ws.close();
  }, []);

  // Timer update effect
  useEffect(() => {
    if (!testTimer.active) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - testTimer.startTime;
      const remaining = Math.max(0, testTimer.duration - elapsed);
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setTimerDisplay(`${minutes}:${seconds.toString().padStart(2, '0')}`);

      if (remaining === 0) {
        setTestTimer(prev => ({ ...prev, active: false }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [testTimer.active, testTimer.startTime, testTimer.duration]);

  const startTestTimer = () => {
    setTestTimer({ active: true, startTime: Date.now(), duration: 5 * 60 * 1000 });
    setTimerDisplay('5:00');
  };

  const stopTestTimer = () => {
    setTestTimer(prev => ({ ...prev, active: false }));
  };

  const minecraftState = gameState?.metadata as any;

  // Minecraft block pattern for decorative borders
  const BlockBorder = ({ children, color = '#4ADE80' }: { children: React.ReactNode; color?: string }) => (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
      borderRadius: '4px',
      overflow: 'hidden',
    }}>
      {/* Pixelated border effect */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '4px',
        background: `repeating-linear-gradient(90deg, ${color} 0px, ${color} 8px, transparent 8px, transparent 16px)`,
      }} />
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '4px',
        background: `repeating-linear-gradient(90deg, ${color}88 0px, ${color}88 8px, transparent 8px, transparent 16px)`,
      }} />
      {children}
    </div>
  );

  // Smart item name abbreviation for inventory display
  const getItemDisplayName = (name: string): string => {
    // === TOOLS ===
    if (name.includes('pickaxe')) return 'PICK';
    if (name.includes('_axe') && !name.includes('pickaxe')) return 'AXE';
    if (name.includes('sword')) return 'SWRD';
    if (name.includes('shovel')) return 'SHVL';
    if (name.includes('hoe')) return 'HOE';
    if (name.includes('fishing_rod')) return 'ROD';
    if (name.includes('shears')) return 'SHRS';
    if (name.includes('flint_and_steel')) return 'FLNT';
    if (name.includes('bucket')) return 'BCKT';
    if (name.includes('compass')) return 'COMP';
    if (name.includes('clock')) return 'CLCK';
    if (name.includes('map')) return 'MAP';
    if (name.includes('lead')) return 'LEAD';
    if (name.includes('name_tag')) return 'NAME';

    // === WEAPONS ===
    if (name.includes('bow') && !name.includes('bowl')) return 'BOW';
    if (name.includes('crossbow')) return 'XBOW';
    if (name.includes('arrow')) return 'ARRW';
    if (name.includes('trident')) return 'TRDT';
    if (name.includes('shield')) return 'SHLD';

    // === ARMOR ===
    if (name.includes('helmet') || name.includes('turtle_shell')) return 'HELM';
    if (name.includes('chestplate')) return 'CHST';
    if (name.includes('leggings')) return 'LEGS';
    if (name.includes('boots')) return 'BOOT';
    if (name.includes('elytra')) return 'ELYT';

    // === FOOD (Cooked) ===
    if (name.includes('cooked_beef') || name.includes('steak')) return 'STEK';
    if (name.includes('cooked_pork')) return 'PORK';
    if (name.includes('cooked_chicken')) return 'CHKN';
    if (name.includes('cooked_mutton')) return 'MUTN';
    if (name.includes('cooked_cod')) return 'FISH';
    if (name.includes('cooked_salmon')) return 'SALM';
    if (name.includes('cooked_rabbit')) return 'RABT';

    // === FOOD (Raw) ===
    if (name.includes('beef') && !name.includes('cooked')) return 'RAWB';
    if (name.includes('porkchop') && !name.includes('cooked')) return 'RAWP';
    if (name.includes('chicken') && !name.includes('cooked')) return 'RAWC';
    if (name.includes('mutton') && !name.includes('cooked')) return 'RAWM';
    if (name.includes('cod') && !name.includes('cooked')) return 'RWCD';
    if (name.includes('salmon') && !name.includes('cooked')) return 'RWSM';
    if (name.includes('rabbit') && !name.includes('cooked')) return 'RWRB';

    // === FOOD (Other) ===
    if (name.includes('golden_apple')) return 'GAPP';
    if (name.includes('apple')) return 'APPL';
    if (name.includes('bread')) return 'BRED';
    if (name.includes('carrot')) return 'CRRT';
    if (name.includes('potato') && name.includes('baked')) return 'BKPT';
    if (name.includes('potato') && name.includes('poison')) return 'PSNP';
    if (name.includes('potato')) return 'POTA';
    if (name.includes('melon_slice')) return 'MELN';
    if (name.includes('pumpkin_pie')) return 'PIE';
    if (name.includes('cookie')) return 'COOK';
    if (name.includes('cake')) return 'CAKE';
    if (name.includes('mushroom_stew')) return 'STEW';
    if (name.includes('beetroot_soup')) return 'BEET';
    if (name.includes('rabbit_stew')) return 'RSTW';
    if (name.includes('honey_bottle')) return 'HONY';
    if (name.includes('sweet_berries')) return 'BERY';
    if (name.includes('glow_berries')) return 'GLBR';

    // === MATERIALS ===
    if (name.includes('netherite_ingot')) return 'NETH';
    if (name.includes('netherite_scrap')) return 'NSCP';
    if (name.includes('diamond') && !name.includes('block')) return 'DIAM';
    if (name.includes('emerald') && !name.includes('block')) return 'EMLD';
    if (name.includes('gold_ingot')) return 'GOLD';
    if (name.includes('gold_nugget')) return 'GNUG';
    if (name.includes('iron_ingot')) return 'IRON';
    if (name.includes('iron_nugget')) return 'INUG';
    if (name.includes('copper_ingot')) return 'COPR';
    if (name.includes('coal') && !name.includes('block') && !name.includes('charcoal')) return 'COAL';
    if (name.includes('charcoal')) return 'CHCL';
    if (name.includes('lapis')) return 'LAPS';
    if (name.includes('redstone') && !name.includes('block')) return 'RDST';
    if (name.includes('quartz') && !name.includes('block')) return 'QRTZ';
    if (name.includes('amethyst_shard')) return 'AMTH';

    // === CRAFTING MATERIALS ===
    if (name.includes('stick')) return 'STCK';
    if (name.includes('string')) return 'STRG';
    if (name.includes('leather')) return 'LTHR';
    if (name.includes('paper')) return 'PAPR';
    if (name.includes('book') && !name.includes('enchant')) return 'BOOK';
    if (name.includes('enchanted_book')) return 'ENBK';
    if (name.includes('feather')) return 'FTHR';
    if (name.includes('flint')) return 'FLNT';
    if (name.includes('clay_ball')) return 'CLAY';
    if (name.includes('brick') && !name.includes('block')) return 'BRCK';
    if (name.includes('bone_meal')) return 'BMEL';
    if (name.includes('bone')) return 'BONE';
    if (name.includes('gunpowder')) return 'GNPW';
    if (name.includes('blaze_rod')) return 'BROD';
    if (name.includes('blaze_powder')) return 'BPOW';
    if (name.includes('ender_pearl')) return 'EPRL';
    if (name.includes('ender_eye')) return 'EEYE';
    if (name.includes('ghast_tear')) return 'TEAR';
    if (name.includes('slimeball')) return 'SLIM';
    if (name.includes('magma_cream')) return 'MGMA';
    if (name.includes('nether_star')) return 'STAR';
    if (name.includes('glowstone_dust')) return 'GLOW';

    // === BLOCKS ===
    if (name.includes('_log') || name === 'oak_wood' || name.includes('_wood')) return 'LOG';
    if (name.includes('_planks') || name.includes('planks')) return 'PLNK';
    if (name.includes('crafting_table')) return 'CRFT';
    if (name.includes('furnace')) return 'FRNC';
    if (name.includes('chest') && !name.includes('chestplate')) return 'CHST';
    if (name.includes('cobblestone') && !name.includes('slab') && !name.includes('stair')) return 'COBB';
    if (name.includes('stone') && !name.includes('cobble') && !name.includes('slab') && !name.includes('stair')) return 'STON';
    if (name.includes('dirt')) return 'DIRT';
    if (name.includes('grass_block')) return 'GRAS';
    if (name.includes('sand') && !name.includes('stone')) return 'SAND';
    if (name.includes('gravel')) return 'GRVL';
    if (name.includes('glass') && !name.includes('pane')) return 'GLAS';
    if (name.includes('glass_pane')) return 'PANE';
    if (name.includes('torch') && !name.includes('soul')) return 'TRCH';
    if (name.includes('soul_torch')) return 'SLTR';
    if (name.includes('lantern') && !name.includes('soul')) return 'LNTN';
    if (name.includes('soul_lantern')) return 'SLLN';
    if (name.includes('bed')) return 'BED';
    if (name.includes('door') && !name.includes('trap')) return 'DOOR';
    if (name.includes('trapdoor')) return 'TRAP';
    if (name.includes('fence') && !name.includes('gate')) return 'FNCE';
    if (name.includes('fence_gate')) return 'GATE';
    if (name.includes('ladder')) return 'LADR';
    if (name.includes('rail') && !name.includes('powered') && !name.includes('detector') && !name.includes('activator')) return 'RAIL';
    if (name.includes('powered_rail')) return 'PRAL';
    if (name.includes('anvil')) return 'ANVL';
    if (name.includes('brewing_stand')) return 'BREW';
    if (name.includes('enchanting_table')) return 'ENCH';
    if (name.includes('bookshelf')) return 'BKSH';
    if (name.includes('obsidian')) return 'OBSD';
    if (name.includes('tnt')) return 'TNT';

    // === ORES ===
    if (name.includes('iron_ore')) return 'IORE';
    if (name.includes('gold_ore')) return 'GORE';
    if (name.includes('diamond_ore')) return 'DORE';
    if (name.includes('coal_ore')) return 'CORE';
    if (name.includes('copper_ore')) return 'CPOR';
    if (name.includes('lapis_ore')) return 'LORE';
    if (name.includes('redstone_ore')) return 'RORE';
    if (name.includes('emerald_ore')) return 'EORE';

    // === SEEDS & FARMING ===
    if (name.includes('wheat_seeds') || name === 'seeds') return 'SEED';
    if (name.includes('wheat') && !name.includes('seed')) return 'WHET';
    if (name.includes('pumpkin_seeds')) return 'PSED';
    if (name.includes('melon_seeds')) return 'MSED';
    if (name.includes('beetroot_seeds')) return 'BSED';
    if (name.includes('egg')) return 'EGG';
    if (name.includes('milk_bucket')) return 'MILK';
    if (name.includes('sugar')) return 'SUGR';

    // === DYES ===
    if (name.includes('_dye')) return 'DYE';
    if (name.includes('ink_sac')) return 'INK';

    // === MISC ===
    if (name.includes('experience_bottle')) return 'XPBT';
    if (name.includes('totem')) return 'TOTM';
    if (name.includes('saddle')) return 'SADL';
    if (name.includes('minecart')) return 'CART';
    if (name.includes('boat')) return 'BOAT';

    // Default: first 4 chars of first word, uppercase
    return name.split('_')[0].substring(0, 4).toUpperCase();
  };

  // Inventory slot component
  const InventorySlot = ({ item }: { item?: { name: string; count: number } }) => (
    <div style={{
      width: '48px',
      height: '48px',
      background: item
        ? 'linear-gradient(135deg, #374151 0%, #1F2937 100%)'
        : 'linear-gradient(135deg, #1F2937 0%, #111827 100%)',
      border: '3px solid',
      borderColor: item ? '#4B5563 #374151 #374151 #4B5563' : '#374151 #1F2937 #1F2937 #374151',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      imageRendering: 'pixelated',
    }}>
      {item && (
        <>
          <span style={{
            fontSize: '10px',
            textAlign: 'center',
            color: '#E5E7EB',
            fontFamily: '"Press Start 2P", monospace',
            textShadow: '1px 1px 0 #000',
            lineHeight: 1.2,
          }}>
            {getItemDisplayName(item.name)}
          </span>
          <span style={{
            position: 'absolute',
            bottom: '2px',
            right: '4px',
            fontSize: '10px',
            fontFamily: '"Press Start 2P", monospace',
            color: '#FEF08A',
            textShadow: '1px 1px 0 #000, -1px -1px 0 #000',
          }}>
            {item.count}
          </span>
        </>
      )}
    </div>
  );

  // Heart icon for health
  const Heart = ({ filled }: { filled: boolean }) => (
    <div style={{
      width: '14px',
      height: '14px',
      background: filled
        ? 'linear-gradient(180deg, #EF4444 0%, #B91C1C 100%)'
        : 'linear-gradient(180deg, #374151 0%, #1F2937 100%)',
      clipPath: 'polygon(50% 0%, 100% 35%, 100% 70%, 50% 100%, 0% 70%, 0% 35%)',
      border: '1px solid',
      borderColor: filled ? '#F87171' : '#4B5563',
      boxShadow: filled ? '0 0 8px rgba(239, 68, 68, 0.5)' : 'none',
    }} />
  );

  // Food icon for hunger
  const Food = ({ filled }: { filled: boolean }) => (
    <div style={{
      width: '14px',
      height: '14px',
      background: filled
        ? 'linear-gradient(180deg, #F59E0B 0%, #B45309 100%)'
        : 'linear-gradient(180deg, #374151 0%, #1F2937 100%)',
      borderRadius: '50%',
      border: '1px solid',
      borderColor: filled ? '#FBBF24' : '#4B5563',
      boxShadow: filled ? '0 0 8px rgba(245, 158, 11, 0.5)' : 'none',
    }} />
  );

  // Show loading screen while connecting
  if (!connected || !gameState) {
    return (
      <div style={{
        height: '100vh',
        background: 'linear-gradient(180deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", system-ui, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
          @keyframes pixelPulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.8; }
          }
          @keyframes blockFloat {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            25% { transform: translateY(-10px) rotate(2deg); }
            75% { transform: translateY(-5px) rotate(-2deg); }
          }
          @keyframes loadingSlide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
          .dot-1 { animation: dotBlink 1.4s infinite 0s; }
          .dot-2 { animation: dotBlink 1.4s infinite 0.2s; }
          .dot-3 { animation: dotBlink 1.4s infinite 0.4s; }
          @keyframes dotBlink {
            0%, 20% { opacity: 0; }
            40%, 100% { opacity: 1; }
          }
        `}</style>

        {/* Animated background blocks */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.15 }}>
          {[...Array(30)].map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: `${20 + (i % 4) * 10}px`,
                height: `${20 + (i % 4) * 10}px`,
                background: i % 4 === 0 ? '#4ADE80' : i % 4 === 1 ? '#8B5CF6' : i % 4 === 2 ? '#60A5FA' : '#F59E0B',
                left: `${(i * 11) % 100}%`,
                top: `${(i * 17) % 100}%`,
                animationName: 'blockFloat',
                animationDuration: `${4 + (i % 3)}s`,
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${i * 0.15}s`,
                borderRadius: '4px',
              }}
            />
          ))}
        </div>

        {/* Main loading content */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '32px',
          zIndex: 1,
        }}>
          {/* Animated pickaxe/block icon */}
          <div style={{
            fontSize: '64px',
            animation: 'pixelPulse 2s ease-in-out infinite',
          }}>
            ⛏️
          </div>

          {/* Title */}
          <div style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '24px',
            color: '#4ADE80',
            textShadow: '2px 2px 0 #15803D, 4px 4px 0 #000',
            letterSpacing: '2px',
          }}>
            NEUTRALTAU
          </div>

          {/* Loading bar container */}
          <div style={{
            width: '280px',
            height: '24px',
            background: '#1F2937',
            border: '4px solid #374151',
            borderRadius: '4px',
            overflow: 'hidden',
            position: 'relative',
          }}>
            {/* Indeterminate loading bar - slides back and forth */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: '50%',
              background: 'linear-gradient(90deg, transparent 0%, #4ADE80 30%, #22C55E 50%, #4ADE80 70%, transparent 100%)',
              animation: 'loadingSlide 1.5s ease-in-out infinite',
            }} />
            {/* Static base color */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: connected ? '70%' : '30%',
              background: 'repeating-linear-gradient(90deg, #4ADE80 0px, #4ADE80 16px, #22C55E 16px, #22C55E 32px)',
              opacity: 0.5,
              transition: 'width 2s ease-out',
            }} />
          </div>

          {/* Status text */}
          <div style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '10px',
            color: '#94A3B8',
            textAlign: 'center',
          }}>
            {!connected ? (
              <span>
                CONNECTING TO SERVER
                <span className="dot-1">.</span>
                <span className="dot-2">.</span>
                <span className="dot-3">.</span>
              </span>
            ) : (
              <span>
                LOADING WORLD
                <span className="dot-1">.</span>
                <span className="dot-2">.</span>
                <span className="dot-3">.</span>
              </span>
            )}
          </div>

          {/* Subtitle */}
          <div style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '8px',
            color: '#64748B',
            marginTop: '16px',
          }}>
            AUTONOMOUS AI MINECRAFT PLAYER
          </div>
        </div>
      </div>
    );
  }

  // For OBS overlay modes - render only specific widgets
  if (overlayMode === 'chat') {
    return (
      <div style={{ background: 'transparent', padding: '10px' }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
          body { background: transparent !important; }
        `}</style>
        {/* Chat-only widget */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: '8px',
          padding: '12px',
          border: '2px solid rgba(139, 92, 246, 0.3)',
          maxHeight: '400px',
          overflow: 'hidden',
        }}>
          <h3 style={{
            fontSize: '10px',
            fontFamily: '"Press Start 2P", monospace',
            color: '#A78BFA',
            margin: '0 0 10px 0',
          }}>🟣 TWITCH CHAT</h3>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {viewerChat.slice(-10).map((msg) => (
              <div key={msg.id} style={{ marginBottom: '6px', padding: '4px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                <span style={{ fontSize: '10px', color: msg.badges.subscriber ? '#F59E0B' : '#A78BFA', fontWeight: 'bold' }}>
                  {msg.badges.moderator && '⚔️ '}{msg.badges.subscriber && '⭐ '}{msg.username}:
                </span>
                <span style={{ fontSize: '11px', color: '#E5E7EB', marginLeft: '6px' }}>{msg.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (overlayMode === 'alerts') {
    return (
      <div style={{ background: 'transparent', position: 'relative', width: '100vw', height: '100vh' }}>
        <style>{`body { background: transparent !important; }`}</style>
        {/* Donation alerts only */}
        {donationAlert && (
          <div style={{
            position: 'absolute',
            top: '10%',
            left: '50%',
            transform: 'translateX(-50%)',
          }}>
            {/* Same alert component as main view */}
            <div style={{
              padding: '25px 50px',
              background: donationAlert.type === 'bits' 
                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.98) 0%, rgba(88, 28, 135, 0.98) 100%)'
                : 'linear-gradient(135deg, rgba(251, 191, 36, 0.98) 0%, rgba(245, 158, 11, 0.98) 100%)',
              border: `5px solid ${donationAlert.type === 'bits' ? '#A78BFA' : '#FBBF24'}`,
              borderRadius: '12px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '40px', marginBottom: '10px' }}>
                {donationAlert.type === 'bits' ? '💎' : '⭐'}
              </div>
              <div style={{ fontSize: '18px', fontFamily: '"Press Start 2P", monospace', color: '#fff' }}>
                {donationAlert.displayName}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (overlayMode === 'stats') {
    return (
      <div style={{ background: 'transparent', padding: '10px' }}>
        <style>{`body { background: transparent !important; }`}</style>
        {/* Stats-only widget */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.85)',
          borderRadius: '8px',
          padding: '10px 15px',
          border: '2px solid rgba(74, 222, 128, 0.3)',
          display: 'inline-flex',
          gap: '20px',
        }}>
          <div style={{ fontSize: '10px', color: '#4ADE80' }}>🪵 {sessionStats.logsMined}</div>
          <div style={{ fontSize: '10px', color: '#60A5FA' }}>⛏️ {sessionStats.blocksMined}</div>
          <div style={{ fontSize: '10px', color: '#FBBF24' }}>🔨 {sessionStats.itemsCrafted}</div>
          <div style={{ fontSize: '10px', color: '#EF4444' }}>💀 {sessionStats.deaths}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh',
      background: overlayMode === 'overlay' ? 'transparent' : 'linear-gradient(180deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
      color: '#F8FAFC',
      fontFamily: '"Inter", system-ui, sans-serif',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Load Minecraft-style font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.95); }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        @keyframes glow {
          0%, 100% { box-shadow: 0 0 20px rgba(74, 222, 128, 0.4); }
          50% { box-shadow: 0 0 40px rgba(74, 222, 128, 0.8); }
        }

        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }

        @keyframes craftSparkle {
          0% { 
            opacity: 0; 
            transform: scale(0.5) rotate(-180deg);
          }
          20% { 
            opacity: 1; 
            transform: scale(1.2) rotate(0deg);
          }
          40% {
            transform: scale(1) rotate(10deg);
          }
          60% {
            transform: scale(1.1) rotate(-5deg);
          }
          80% { 
            opacity: 1;
            transform: scale(1) rotate(0deg);
          }
          100% { 
            opacity: 0; 
            transform: scale(0.8) translateY(-30px);
          }
        }

        @keyframes craftGlow {
          0%, 100% { box-shadow: 0 0 10px rgba(251, 191, 36, 0.5); }
          50% { box-shadow: 0 0 25px rgba(251, 191, 36, 0.9), 0 0 50px rgba(251, 191, 36, 0.5); }
        }

        @keyframes milestoneBurst {
          0% { 
            opacity: 0; 
            transform: scale(0.3) rotate(-10deg);
          }
          30% { 
            opacity: 1; 
            transform: scale(1.2) rotate(5deg);
          }
          50% {
            transform: scale(1) rotate(-3deg);
          }
          70% {
            transform: scale(1.05) rotate(2deg);
          }
          100% { 
            opacity: 1; 
            transform: scale(1) rotate(0deg);
          }
        }

        @keyframes milestoneGlow {
          0%, 100% { 
            box-shadow: 0 0 30px rgba(251, 191, 36, 0.8), 0 0 60px rgba(251, 191, 36, 0.4);
            filter: brightness(1);
          }
          50% { 
            box-shadow: 0 0 60px rgba(251, 191, 36, 1), 0 0 100px rgba(251, 191, 36, 0.6);
            filter: brightness(1.2);
          }
        }

        @keyframes donationSlide {
          0% { 
            opacity: 0; 
            transform: translateX(-50%) translateY(-100px) scale(0.5);
          }
          50% { 
            transform: translateX(-50%) translateY(10px) scale(1.1);
          }
          100% { 
            opacity: 1; 
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }

        @keyframes donationPulse {
          0%, 100% { 
            transform: scale(1);
            filter: brightness(1);
          }
          50% { 
            transform: scale(1.02);
            filter: brightness(1.15);
          }
        }

        @keyframes donationBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }

        @keyframes milestoneFadeOut {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.8) translateY(-20px); }
        }

        @keyframes statPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }

        @keyframes itemBob {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }

        @keyframes itemSwing {
          0% { transform: rotate(0deg) translateX(0); }
          25% { transform: rotate(-25deg) translateX(-5px); }
          50% { transform: rotate(15deg) translateX(5px); }
          75% { transform: rotate(-10deg) translateX(-3px); }
          100% { transform: rotate(0deg) translateX(0); }
        }

        @keyframes itemAttack {
          0% { transform: rotate(0deg) scale(1); }
          30% { transform: rotate(-45deg) scale(1.1) translateX(-10px); }
          60% { transform: rotate(20deg) scale(1.05); }
          100% { transform: rotate(0deg) scale(1); }
        }

        @keyframes pickupFloat {
          0% { 
            opacity: 0; 
            transform: translateY(20px) scale(0.8); 
          }
          15% { 
            opacity: 1; 
            transform: translateY(0) scale(1.1); 
          }
          30% { 
            transform: translateY(-5px) scale(1); 
          }
          70% { 
            opacity: 1; 
            transform: translateY(-30px) scale(1); 
          }
          100% { 
            opacity: 0; 
            transform: translateY(-60px) scale(0.8); 
          }
        }

        @keyframes itemEat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-15px) rotate(-10deg); }
          50% { transform: translateY(-10px) rotate(5deg); }
          75% { transform: translateY(-15px) rotate(-5deg); }
        }

        @keyframes itemPlace {
          0% { transform: translateY(0) scale(1); }
          50% { transform: translateY(10px) scale(0.9); }
          100% { transform: translateY(0) scale(1); }
        }

        @keyframes avatarTalk {
          0% { transform: scaleY(1) scaleX(1); }
          100% { transform: scaleY(0.97) scaleX(1.01); }
        }

        @keyframes avatarIdle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }

        @keyframes speakingDot {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.5); opacity: 1; }
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #1F2937; }
        ::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #4ADE80 0%, #22C55E 100%);
          border: 2px solid #1F2937;
        }
      `}</style>

      {/* Animated background blocks */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.1 }}>
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: '32px',
              height: '32px',
              background: i % 3 === 0 ? '#4ADE80' : i % 3 === 1 ? '#60A5FA' : '#F472B6',
              left: `${(i * 7) % 100}%`,
              top: `${(i * 13) % 100}%`,
              animationName: 'float',
              animationDuration: `${3 + (i % 4)}s`,
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: 'infinite',
              animationDelay: `${i * 0.2}s`,
              borderRadius: '4px',
            }}
          />
        ))}
      </div>

      {/* Header */}
      <header style={{
        height: '70px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(15, 23, 42, 0.95) 100%)',
        borderBottom: '4px solid #4ADE80',
        position: 'relative',
        zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Minecraft-style grass block logo */}
          <div style={{
            width: '44px',
            height: '44px',
            position: 'relative',
            imageRendering: 'pixelated',
          }}>
            {/* Grass top */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '14px',
              background: 'linear-gradient(180deg, #4ADE80 0%, #22C55E 100%)',
              borderRadius: '4px 4px 0 0',
            }} />
            {/* Dirt body */}
            <div style={{
              position: 'absolute',
              top: '14px',
              left: 0,
              right: 0,
              bottom: 0,
              background: 'linear-gradient(180deg, #92400E 0%, #78350F 100%)',
              borderRadius: '0 0 4px 4px',
            }} />
            {/* T letter */}
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontFamily: '"Press Start 2P", monospace',
              color: '#FEF3C7',
              textShadow: '2px 2px 0 #000',
            }}>T</div>
          </div>

          <div>
            <h1 style={{
              margin: 0,
              fontSize: '16px',
              fontFamily: '"Press Start 2P", monospace',
              color: '#4ADE80',
              textShadow: '2px 2px 0 #000',
              letterSpacing: '2px',
            }}>
              NEUTRALTAU
            </h1>
            <p style={{
              margin: 0,
              fontSize: '8px',
              fontFamily: '"Press Start 2P", monospace',
              color: '#94A3B8',
              letterSpacing: '1px',
            }}>
              AUTONOMOUS AI
            </p>
          </div>
        </div>

        {/* Right side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Audio Toggle */}
          <button
            onClick={() => {
              const audio = new Audio();
              audio.play().catch(() => {});
              setAudioEnabled(true);
              playNextAudio();
              if (!musicEnabled) {
                startMusic();
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 16px',
              background: (audioEnabled && musicEnabled)
                ? 'linear-gradient(135deg, rgba(74, 222, 128, 0.2) 0%, rgba(34, 197, 94, 0.1) 100%)'
                : 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.1) 100%)',
              border: `3px solid ${(audioEnabled && musicEnabled) ? '#4ADE80' : '#EF4444'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ fontSize: '16px' }}>
              {(audioEnabled && musicEnabled) ? '🔊' : '🔇'}
            </span>
            <span style={{
              fontSize: '9px',
              fontFamily: '"Press Start 2P", monospace',
              color: (audioEnabled && musicEnabled) ? '#4ADE80' : '#EF4444',
              textShadow: '1px 1px 0 #000',
            }}>
              {(audioEnabled && musicEnabled) ? 'AUDIO ON' : 'AUDIO OFF'}
            </span>
            {musicEnabled && (
              <input
                type="range"
                min="0"
                max="0.4"
                step="0.05"
                value={musicVolume}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                style={{
                  width: '60px',
                  height: '4px',
                  cursor: 'pointer',
                  marginLeft: '4px',
                }}
              />
            )}
          </button>

          {/* Status indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 20px',
            background: connected
              ? 'linear-gradient(135deg, rgba(74, 222, 128, 0.2) 0%, rgba(34, 197, 94, 0.1) 100%)'
              : 'rgba(100, 100, 100, 0.2)',
            border: `3px solid ${connected ? '#4ADE80' : '#6B7280'}`,
            borderRadius: '4px',
            animation: connected ? 'glow 2s ease-in-out infinite' : 'none',
          }}>
            <div style={{
              width: '12px',
              height: '12px',
              background: connected ? '#4ADE80' : '#6B7280',
              borderRadius: '2px',
              animation: connected ? 'pulse 1s ease-in-out infinite' : 'none',
            }} />
            <span style={{
              fontSize: '10px',
              fontFamily: '"Press Start 2P", monospace',
              color: connected ? '#4ADE80' : '#6B7280',
              textShadow: '1px 1px 0 #000',
            }}>
              {connected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr 360px',
        height: 'calc(100vh - 70px)',
        gap: '16px',
        padding: '16px',
      }}>

        {/* Left Sidebar - Stats */}
        <aside style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          overflowY: 'auto',
        }}>
          {minecraftState ? (
            <>
              {/* Sponsored By */}
              <BlockBorder color="#FFD700">
                <div style={{
                  padding: '16px',
                  background: 'linear-gradient(135deg, rgba(255,215,0,0.1) 0%, rgba(255,165,0,0.1) 100%)',
                }}>
                  <div style={{
                    fontSize: '8px',
                    fontFamily: '"Press Start 2P", monospace',
                    color: '#9CA3AF',
                    textAlign: 'center',
                    marginBottom: '8px',
                    letterSpacing: '2px',
                  }}>
                    SPONSORED BY
                  </div>
                  <div style={{
                    background: 'rgba(0,0,0,0.4)',
                    padding: '16px',
                    textAlign: 'center',
                    border: '2px solid #FFD700',
                    borderRadius: '4px',
                  }}>
                    <span style={{
                      fontSize: '12px',
                      fontFamily: '"Press Start 2P", monospace',
                      color: '#FFD700',
                      textShadow: '2px 2px 0 #000, -1px -1px 0 #B8860B',
                      display: 'block',
                    }}>Your Brand</span>
                    <span style={{
                      fontSize: '7px',
                      fontFamily: '"Press Start 2P", monospace',
                      color: '#9CA3AF',
                      display: 'block',
                      marginTop: '6px',
                    }}>advertise here</span>
                  </div>
                </div>
              </BlockBorder>

              {/* Health & Hunger */}
              <BlockBorder color="#EF4444">
                <div style={{ padding: '16px' }}>
                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '10px',
                    fontFamily: '"Press Start 2P", monospace',
                    color: '#EF4444',
                    textShadow: '1px 1px 0 #000',
                  }}>
                    HEALTH
                  </h3>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '16px' }}>
                    {[...Array(10)].map((_, i) => (
                      <Heart key={i} filled={i < Math.ceil((minecraftState.health || 0) / 2)} />
                    ))}
                  </div>

                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '10px',
                    fontFamily: '"Press Start 2P", monospace',
                    color: '#F59E0B',
                    textShadow: '1px 1px 0 #000',
                  }}>
                    HUNGER
                  </h3>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {[...Array(10)].map((_, i) => (
                      <Food key={i} filled={i < Math.ceil((minecraftState.food || 0) / 2)} />
                    ))}
                  </div>
                </div>
              </BlockBorder>

              {/* Environment */}
              <BlockBorder color="#A78BFA">
                <div style={{ padding: '16px' }}>
                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '10px',
                    fontFamily: '"Press Start 2P", monospace',
                    color: '#A78BFA',
                    textShadow: '1px 1px 0 #000',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <span style={{ fontSize: '16px' }}>🌍</span>
                    WORLD
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '10px',
                      background: 'rgba(0,0,0,0.4)',
                      border: '2px solid #374151',
                    }}>
                      <span style={{ fontSize: '10px', color: '#94A3B8' }}>Time</span>
                      <span style={{
                        fontSize: '10px',
                        fontFamily: '"Press Start 2P", monospace',
                        color: (minecraftState.time === 'day' || minecraftState.time === 'morning') ? '#FEF08A' : '#60A5FA',
                        textShadow: '1px 1px 0 #000',
                      }}>
                        {minecraftState.time === 'day' ? '☀ DAY' : 
                         minecraftState.time === 'morning' ? '🌅 MORNING' :
                         minecraftState.time === 'evening' ? '🌆 EVENING' : '🌙 NIGHT'}
                      </span>
                    </div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '10px',
                      background: 'rgba(0,0,0,0.4)',
                      border: '2px solid #374151',
                    }}>
                      <span style={{ fontSize: '10px', color: '#94A3B8' }}>Weather</span>
                      <span style={{
                        fontSize: '10px',
                        fontFamily: '"Press Start 2P", monospace',
                        color: '#fff',
                        textShadow: '1px 1px 0 #000',
                      }}>
                        {minecraftState.weather === 'rain' ? '🌧 RAIN' :
                         minecraftState.weather === 'thunder' ? '⛈ STORM' : '☀ CLEAR'}
                      </span>
                    </div>
                  </div>
                </div>
              </BlockBorder>

              {/* Activity Indicator */}
              {activity.active && activity.type !== 'idle' && (
                <BlockBorder color={
                  activity.type === 'crafting' ? '#A855F7' : 
                  activity.type === 'attacking' ? '#EF4444' : '#F59E0B'
                }>
                  <div style={{
                    padding: '12px 16px',
                    background: activity.type === 'crafting'
                      ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(139, 92, 246, 0.1) 100%)'
                      : activity.type === 'attacking'
                        ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.1) 100%)'
                        : 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.1) 100%)',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                    }}>
                      <span style={{
                        fontSize: '20px',
                        animation: activity.type === 'attacking' ? 'pulse 0.3s ease-in-out infinite' : 'pulse 1s ease-in-out infinite',
                      }}>
                        {activity.type === 'crafting' ? '🔨' : activity.type === 'attacking' ? '⚔️' : '⛏️'}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        fontFamily: '"Press Start 2P", monospace',
                        color: activity.type === 'crafting' ? '#A855F7' : 
                               activity.type === 'attacking' ? '#EF4444' : '#F59E0B',
                        textShadow: '1px 1px 0 #000',
                        animation: activity.type === 'attacking' ? 'pulse 0.3s ease-in-out infinite' : 'pulse 1s ease-in-out infinite',
                      }}>
                        {activity.type === 'crafting' ? 'CRAFTING' : 
                         activity.type === 'attacking' ? 'ATTACKING' : 'MINING'}
                      </span>
                      {activity.item && (
                        <span style={{
                          fontSize: '9px',
                          fontFamily: '"Press Start 2P", monospace',
                          color: '#9CA3AF',
                          textShadow: '1px 1px 0 #000',
                        }}>
                          {activity.item.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                </BlockBorder>
              )}

              {/* Inventory */}
              <BlockBorder color="#4ADE80">
                <div style={{ padding: '16px' }}>
                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '10px',
                    fontFamily: '"Press Start 2P", monospace',
                    color: '#4ADE80',
                    textShadow: '1px 1px 0 #000',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <span style={{ fontSize: '16px' }}>🎒</span>
                    INVENTORY
                  </h3>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '4px',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '8px',
                    border: '2px solid #374151',
                  }}>
                    {(() => {
                      const inv = minecraftState.inventory || [];
                      const slots = [...inv, ...Array(Math.max(0, 8 - inv.length)).fill(null)].slice(0, 8);
                      return slots.map((item: any, i: number) => (
                        <InventorySlot key={i} item={item} />
                      ));
                    })()}
                  </div>
                </div>
              </BlockBorder>
            </>
          ) : (
            <BlockBorder>
              <div style={{
                padding: '40px',
                textAlign: 'center',
              }}>
                <div style={{
                  fontSize: '32px',
                  marginBottom: '16px',
                  animation: 'float 2s ease-in-out infinite',
                }}>⏳</div>
                <span style={{
                  fontSize: '10px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#94A3B8',
                }}>
                  LOADING...
                </span>
              </div>
            </BlockBorder>
          )}
        </aside>

        {/* Center - Game View */}
        <main style={{
          position: 'relative',
          background: '#000',
          border: '4px solid #4ADE80',
          borderRadius: '4px',
          overflow: 'hidden',
          boxShadow: '0 0 30px rgba(74, 222, 128, 0.2)',
        }}>
          <iframe
            src={`http://localhost:${viewerPort}`}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#000',
            }}
            title="Minecraft Viewer"
          />

          {/* Night overlay effect - darkens the view when it's night time */}
          {(minecraftState.time === 'night' || minecraftState.time === 'evening') && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: minecraftState.time === 'night' 
                ? 'rgba(2, 5, 15, 0.8)'
                : 'rgba(10, 8, 25, 0.55)',
              pointerEvents: 'none',
              transition: 'background 2s ease',
            }} />
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <div style={{
              position: 'absolute',
              top: '16px',
              left: '16px',
              background: thinkingMode === 'advanced'
                ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.95) 0%, rgba(139, 92, 246, 0.95) 100%)'
                : 'linear-gradient(135deg, rgba(59, 130, 246, 0.95) 0%, rgba(37, 99, 235, 0.95) 100%)',
              padding: '12px 20px',
              border: `3px solid ${thinkingMode === 'advanced' ? '#A855F7' : '#3B82F6'}`,
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: `0 0 30px ${thinkingMode === 'advanced' ? 'rgba(168, 85, 247, 0.5)' : 'rgba(59, 130, 246, 0.5)'}`,
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                background: '#fff',
                borderRadius: '2px',
                animation: 'blink 0.5s ease-in-out infinite',
              }} />
              <span style={{
                fontSize: '10px',
                fontFamily: '"Press Start 2P", monospace',
                color: '#fff',
                textShadow: '1px 1px 0 #000',
              }}>
                {thinkingMode === 'advanced' ? 'DEEP THINK' : 'AI IS THINKING'}
              </span>
            </div>
          )}

          {/* Current Objective HUD - Top Left */}
          <div style={{
            position: 'absolute',
            top: isThinking ? '70px' : '16px',
            left: '16px',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
            padding: '12px 20px',
            border: '3px solid #4ADE80',
            borderRadius: '4px',
            boxShadow: '0 0 20px rgba(74, 222, 128, 0.3)',
            minWidth: '200px',
          }}>
            <div style={{
              fontSize: '8px',
              fontFamily: '"Press Start 2P", monospace',
              color: '#94A3B8',
              marginBottom: '6px',
              letterSpacing: '1px',
            }}>
              🎯 OBJECTIVE
            </div>
            <div style={{
              fontSize: '10px',
              fontFamily: '"Press Start 2P", monospace',
              color: '#4ADE80',
              textShadow: '1px 1px 0 #000',
            }}>
              {(() => {
                const inv = minecraftState?.inventory || [];
                const hasPickaxe = inv.some((i: any) => i.name.includes('pickaxe'));
                const hasStonePickaxe = inv.some((i: any) => i.name.includes('stone_pickaxe'));
                const hasSword = inv.some((i: any) => i.name.includes('sword'));
                const hasCraftingTable = inv.some((i: any) => i.name === 'crafting_table');
                const logCount = inv.filter((i: any) => i.name.includes('log')).reduce((sum: number, i: any) => sum + i.count, 0);
                const plankCount = inv.filter((i: any) => i.name.includes('planks')).reduce((sum: number, i: any) => sum + i.count, 0);
                const stickCount = inv.filter((i: any) => i.name === 'stick').reduce((sum: number, i: any) => sum + i.count, 0);
                const cobbleCount = inv.filter((i: any) => i.name === 'cobblestone').reduce((sum: number, i: any) => sum + i.count, 0);

                if (hasStonePickaxe) return 'FIND IRON ORE';
                if (hasPickaxe && cobbleCount < 20) return `MINE STONE (${cobbleCount}/20)`;
                if (hasPickaxe) return 'CRAFT STONE TOOLS';
                if (hasCraftingTable && plankCount >= 3 && stickCount >= 2) return 'CRAFT PICKAXE';
                if (plankCount >= 4 && !hasCraftingTable) return 'CRAFT TABLE';
                if (plankCount >= 2 && stickCount < 2) return 'CRAFT STICKS';
                if (logCount >= 1 && plankCount < 4) return 'CRAFT PLANKS';
                if (logCount < 10) return `GET WOOD (${logCount}/10)`;
                return 'EXPLORE!';
              })()}
            </div>
          </div>

          {/* Session Stats HUD - Top Right */}
          <div style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
            padding: '12px 16px',
            border: '3px solid #60A5FA',
            borderRadius: '4px',
            boxShadow: '0 0 20px rgba(96, 165, 250, 0.3)',
          }}>
            <div style={{
              fontSize: '8px',
              fontFamily: '"Press Start 2P", monospace',
              color: '#94A3B8',
              marginBottom: '8px',
              letterSpacing: '1px',
            }}>
              📊 SESSION
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'auto auto',
              gap: '4px 12px',
              fontSize: '9px',
              fontFamily: '"Press Start 2P", monospace',
            }}>
              <span style={{ color: '#94A3B8' }}>🪵</span>
              <span style={{ color: '#4ADE80' }}>{sessionStats.logsMined}</span>
              <span style={{ color: '#94A3B8' }}>⛏️</span>
              <span style={{ color: '#60A5FA' }}>{sessionStats.blocksMined}</span>
              <span style={{ color: '#94A3B8' }}>🔨</span>
              <span style={{ color: '#FBBF24' }}>{sessionStats.itemsCrafted}</span>
              <span style={{ color: '#94A3B8' }}>💀</span>
              <span style={{ color: '#EF4444' }}>{sessionStats.deaths}</span>
              <span style={{ color: '#94A3B8' }}>⏱️</span>
              <span style={{ color: '#A855F7' }}>
                {Math.floor((Date.now() - sessionStats.startTime) / 60000)}m
              </span>
            </div>
          </div>

          {/* Milestone Celebration - Center, BIG and FLASHY */}
          {milestone && (
            <div style={{
              position: 'absolute',
              top: '20%',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 200,
              pointerEvents: 'none',
            }}>
              <div style={{
                padding: '20px 40px',
                background: milestone.type === 'death' 
                  ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.95) 0%, rgba(185, 28, 28, 0.95) 100%)'
                  : 'linear-gradient(135deg, rgba(251, 191, 36, 0.95) 0%, rgba(245, 158, 11, 0.95) 100%)',
                border: `4px solid ${milestone.type === 'death' ? '#EF4444' : '#FBBF24'}`,
                borderRadius: '8px',
                animation: 'milestoneBurst 0.5s ease-out forwards, milestoneGlow 0.8s ease-in-out infinite',
                textAlign: 'center',
              }}>
                <div style={{
                  fontSize: '20px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textShadow: '3px 3px 0 #000, -1px -1px 0 #000',
                  letterSpacing: '2px',
                }}>
                  {milestone.text}
                </div>
              </div>
            </div>
          )}

          {/* DONATION/SUB/RAID ALERT - HUGE FLASHY OVERLAY */}
          {donationAlert && (
            <div style={{
              position: 'absolute',
              top: '10%',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 300,
              pointerEvents: 'none',
              animation: 'donationSlide 0.5s ease-out forwards',
            }}>
              <div style={{
                padding: donationAlert.type === 'raid' ? '30px 60px' : '25px 50px',
                background: donationAlert.type === 'bits' 
                  ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.98) 0%, rgba(88, 28, 135, 0.98) 100%)'
                  : donationAlert.type === 'raid'
                    ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.98) 0%, rgba(185, 28, 28, 0.98) 100%)'
                    : donationAlert.type === 'gift'
                      ? 'linear-gradient(135deg, rgba(236, 72, 153, 0.98) 0%, rgba(190, 24, 93, 0.98) 100%)'
                      : 'linear-gradient(135deg, rgba(251, 191, 36, 0.98) 0%, rgba(245, 158, 11, 0.98) 100%)',
                border: `5px solid ${
                  donationAlert.type === 'bits' ? '#A78BFA' 
                  : donationAlert.type === 'raid' ? '#EF4444'
                  : donationAlert.type === 'gift' ? '#EC4899'
                  : '#FBBF24'
                }`,
                borderRadius: '12px',
                boxShadow: `0 0 60px ${
                  donationAlert.type === 'bits' ? 'rgba(139, 92, 246, 0.8)' 
                  : donationAlert.type === 'raid' ? 'rgba(239, 68, 68, 0.8)'
                  : donationAlert.type === 'gift' ? 'rgba(236, 72, 153, 0.8)'
                  : 'rgba(251, 191, 36, 0.8)'
                }`,
                animation: 'donationPulse 0.6s ease-in-out infinite',
                textAlign: 'center',
                minWidth: '300px',
              }}>
                {/* Type Icon */}
                <div style={{
                  fontSize: donationAlert.type === 'raid' ? '48px' : '40px',
                  marginBottom: '10px',
                  animation: 'donationBounce 0.5s ease-in-out infinite',
                }}>
                  {donationAlert.type === 'bits' ? '💎' 
                    : donationAlert.type === 'raid' ? '⚔️'
                    : donationAlert.type === 'gift' ? '🎁'
                    : donationAlert.type === 'follow' ? '💜'
                    : '⭐'}
                </div>

                {/* Alert Title */}
                <div style={{
                  fontSize: donationAlert.type === 'raid' ? '24px' : '18px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textShadow: '3px 3px 0 #000, -1px -1px 0 #000',
                  letterSpacing: '2px',
                  marginBottom: '8px',
                }}>
                  {donationAlert.type === 'bits' 
                    ? `${donationAlert.amount} BITS!`
                    : donationAlert.type === 'raid'
                      ? `RAID INCOMING!`
                      : donationAlert.type === 'gift'
                        ? `GIFT SUB${donationAlert.giftCount && donationAlert.giftCount > 1 ? 'S' : ''}!`
                        : donationAlert.type === 'follow'
                          ? 'NEW FOLLOWER!'
                          : 'NEW SUB!'}
                </div>

                {/* Username */}
                <div style={{
                  fontSize: '16px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textShadow: '2px 2px 0 #000',
                  marginBottom: donationAlert.message ? '10px' : '0',
                }}>
                  {donationAlert.displayName}
                  {donationAlert.type === 'raid' && donationAlert.viewerCount && (
                    <span style={{ color: '#FCD34D' }}> +{donationAlert.viewerCount} viewers</span>
                  )}
                  {donationAlert.type === 'subscription' && donationAlert.months && donationAlert.months > 1 && (
                    <span style={{ color: '#FCD34D' }}> ({donationAlert.months} months)</span>
                  )}
                  {donationAlert.type === 'gift' && donationAlert.giftCount && (
                    <span style={{ color: '#FCD34D' }}> x{donationAlert.giftCount}</span>
                  )}
                </div>

                {/* Custom Message if any */}
                {donationAlert.message && (
                  <div style={{
                    fontSize: '12px',
                    color: '#FEF3C7',
                    fontStyle: 'italic',
                    maxWidth: '400px',
                    wordBreak: 'break-word',
                  }}>
                    "{donationAlert.message}"
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Item Pickup Notifications - Center of screen, floating up */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
            zIndex: 100,
          }}>
            {itemPickups.map((pickup) => (
              <div
                key={pickup.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 24px',
                  background: 'linear-gradient(135deg, rgba(74, 222, 128, 0.95) 0%, rgba(34, 197, 94, 0.95) 100%)',
                  border: '4px solid #4ADE80',
                  borderRadius: '8px',
                  boxShadow: '0 0 30px rgba(74, 222, 128, 0.6), 0 4px 20px rgba(0, 0, 0, 0.3)',
                  animation: 'pickupFloat 2s ease-out forwards',
                }}
              >
                <span style={{
                  fontSize: '24px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textShadow: '2px 2px 0 #15803D, -1px -1px 0 #000',
                }}>
                  +{pickup.count}
                </span>
                <span style={{
                  fontSize: '14px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textShadow: '1px 1px 0 #000',
                  textTransform: 'uppercase',
                }}>
                  {pickup.displayName}
                </span>
              </div>
            ))}
            
            {/* Craft notifications - golden/amber color */}
            {itemCrafts.map((craft) => (
              <div
                key={craft.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 24px',
                  background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.95) 0%, rgba(245, 158, 11, 0.95) 100%)',
                  border: '4px solid #FBBF24',
                  borderRadius: '8px',
                  boxShadow: '0 0 30px rgba(251, 191, 36, 0.6), 0 4px 20px rgba(0, 0, 0, 0.3)',
                  animation: 'craftSparkle 2.5s ease-out forwards, craftGlow 0.5s ease-in-out 3',
                }}
              >
                <span style={{
                  fontSize: '18px',
                }}>
                  🔨
                </span>
                <span style={{
                  fontSize: '24px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textShadow: '2px 2px 0 #B45309, -1px -1px 0 #000',
                }}>
                  +{craft.count}
                </span>
                <span style={{
                  fontSize: '14px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textShadow: '1px 1px 0 #000',
                  textTransform: 'uppercase',
                }}>
                  {craft.displayName}
                </span>
              </div>
            ))}
          </div>

          {/* Held Item/Hand Overlay - Always visible */}
          <div style={{
            position: 'absolute',
            bottom: '40px',
            right: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            animation: heldItem.action === 'idle' || !heldItem.name
              ? 'itemBob 2s ease-in-out infinite'
              : heldItem.action === 'mining'
                ? 'itemSwing 0.4s ease-in-out infinite'
                : heldItem.action === 'attacking'
                  ? 'itemAttack 0.3s ease-out infinite'
                  : heldItem.action === 'eating'
                    ? 'itemEat 1s ease-in-out infinite'
                    : heldItem.action === 'placing'
                      ? 'itemPlace 0.5s ease-out'
                      : 'itemBob 2s ease-in-out infinite',
            transformOrigin: 'bottom center',
          }}>
            {/* Item sprite container */}
            <div style={{
              width: '96px',
              height: '96px',
              background: heldItem.name
                ? 'linear-gradient(135deg, rgba(74, 222, 128, 0.2) 0%, rgba(34, 197, 94, 0.1) 100%)'
                : 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(109, 40, 217, 0.1) 100%)',
              border: `4px solid ${heldItem.name ? '#4ADE80' : '#8B5CF6'}`,
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: heldItem.name
                ? '0 0 20px rgba(74, 222, 128, 0.3), inset 0 0 10px rgba(74, 222, 128, 0.1)'
                : '0 0 20px rgba(139, 92, 246, 0.3), inset 0 0 10px rgba(139, 92, 246, 0.1)',
              imageRendering: 'pixelated',
              overflow: 'hidden',
            }}>
              {heldItem.name ? (
                /* Item icon using Minecraft wiki sprites */
                <img
                  src={`https://minecraft.wiki/images/Invicon_${heldItem.name
                    .split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join('_')}.png`}
                  alt={heldItem.displayName || heldItem.name}
                  style={{
                    width: '64px',
                    height: '64px',
                    imageRendering: 'pixelated',
                    filter: 'drop-shadow(2px 2px 0 rgba(0,0,0,0.5))',
                  }}
                  onError={(e) => {
                    // Fallback to a colored square with text
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    target.parentElement!.innerHTML = `<div style="
                      width: 64px;
                      height: 64px;
                      background: linear-gradient(135deg, #4ADE80 0%, #22C55E 100%);
                      border-radius: 4px;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      font-size: 24px;
                      font-family: 'Press Start 2P', monospace;
                      color: #fff;
                      text-shadow: 2px 2px 0 #000;
                    ">${(heldItem.name?.charAt(0) || '?').toUpperCase()}</div>`;
                  }}
                />
              ) : (
                /* Empty hand - Steve's hand from Minecraft */
                <div style={{
                  width: '64px',
                  height: '64px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  filter: 'drop-shadow(2px 2px 0 rgba(0,0,0,0.5))',
                }}>
                  <span role="img" aria-label="hand">✋</span>
                </div>
              )}
            </div>
            {/* Item name label */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.8)',
              padding: '6px 12px',
              borderRadius: '4px',
              border: `2px solid ${heldItem.name ? '#4ADE80' : '#8B5CF6'}`,
            }}>
              <span style={{
                fontSize: '8px',
                fontFamily: '"Press Start 2P", monospace',
                color: heldItem.name ? '#4ADE80' : '#8B5CF6',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                {heldItem.name
                  ? (heldItem.displayName || heldItem.name?.replace(/_/g, ' '))
                  : 'EMPTY HAND'}
              </span>
            </div>
            {/* Action indicator */}
            {heldItem.name && heldItem.action !== 'idle' && (
              <div style={{
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                background: heldItem.action === 'mining' ? '#F59E0B'
                  : heldItem.action === 'attacking' ? '#EF4444'
                  : heldItem.action === 'eating' ? '#22C55E'
                  : '#3B82F6',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '2px solid #fff',
                boxShadow: '0 0 10px rgba(0,0,0,0.5)',
              }}>
                <span style={{
                  fontSize: '6px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  textTransform: 'uppercase',
                }}>
                  {heldItem.action}
                </span>
              </div>
            )}
          </div>

          {/* Corner decorations */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '20px',
            height: '20px',
            borderRight: '4px solid #4ADE80',
            borderBottom: '4px solid #4ADE80',
          }} />
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '20px',
            height: '20px',
            borderLeft: '4px solid #4ADE80',
            borderBottom: '4px solid #4ADE80',
          }} />
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '20px',
            height: '20px',
            borderRight: '4px solid #4ADE80',
            borderTop: '4px solid #4ADE80',
          }} />
          <div style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '20px',
            height: '20px',
            borderLeft: '4px solid #4ADE80',
            borderTop: '4px solid #4ADE80',
          }} />
        </main>

        {/* Right Sidebar - Activity */}
        <aside style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          height: '100%',
          minHeight: 0,
        }}>
          {/* AI Avatar - HERO element at top, takes ~55% */}
          <div style={{
            flex: '0 0 55%',
            position: 'relative',
            border: '3px solid #4ADE80',
            borderRadius: '4px',
            overflow: 'hidden',
            boxShadow: '0 0 20px rgba(74, 222, 128, 0.3), inset 0 0 30px rgba(0,0,0,0.5)',
          }}>
            <Avatar 
              emotion={emotionalState?.dominant || null}
              isSpeaking={isSpeaking}
              isThinking={isThinking}
              isDead={isDead}
            />
            
            {/* Emotion Badge Overlay - top left */}
            {emotionalState && (
              <div style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                zIndex: 20,
              }}>
                {/* Emotion chip */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(0,0,0,0.85)',
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: `2px solid ${EMOTION_COLORS[emotionalState.dominant]}`,
                  boxShadow: `0 0 10px ${EMOTION_COLORS[emotionalState.dominant]}44`,
                }}>
                  <span style={{ fontSize: '16px' }}>{EMOTION_EMOJIS[emotionalState.dominant]}</span>
                  <span style={{
                    fontSize: '7px',
                    fontFamily: '"Press Start 2P", monospace',
                    color: EMOTION_COLORS[emotionalState.dominant],
                  }}>
                    {emotionalState.dominant.toUpperCase()}
                  </span>
                </div>
                {/* Mini intensity bar */}
                <div style={{
                  width: '80px',
                  height: '6px',
                  background: 'rgba(0,0,0,0.8)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  border: '1px solid #374151',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${emotionalState.dominantIntensity}%`,
                    background: EMOTION_COLORS[emotionalState.dominant],
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )}

            
            {/* Name label - bottom center */}
            <div style={{
              position: 'absolute',
              bottom: '10px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.85)',
              padding: '5px 12px',
              border: '2px solid #4ADE80',
              borderRadius: '4px',
              zIndex: 20,
            }}>
              <span style={{
                fontSize: '8px',
                fontFamily: '"Press Start 2P", monospace',
                color: '#4ADE80',
                textShadow: '0 0 10px rgba(74, 222, 128, 0.5)',
              }}>
                NEURAL TAU
              </span>
            </div>
          </div>

          {/* Current Action - Compact bar */}
          {currentDecision && (
            <div style={{
              flexShrink: 0,
              background: 'linear-gradient(90deg, rgba(34, 197, 94, 0.2) 0%, rgba(15, 23, 42, 0.95) 100%)',
              borderRadius: '4px',
              padding: '10px 12px',
              borderLeft: '4px solid #22C55E',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <span style={{ fontSize: '14px' }}>⚡</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '9px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#22C55E',
                  marginBottom: '4px',
                }}>
                  {currentDecision.action.type.toUpperCase()} {currentDecision.action.target?.toUpperCase() || ''}
                </div>
                <div style={{
                  fontSize: '10px',
                  color: '#9CA3AF',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {currentDecision.reasoning}
                </div>
              </div>
            </div>
          )}

          {/* Streamer Chat - Takes remaining space, scrollable */}
          <div style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
            borderRadius: '4px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: 'repeating-linear-gradient(90deg, #EC4899 0px, #EC4899 6px, transparent 6px, transparent 12px)',
            }} />
            
            {/* Chat header */}
            <div style={{
              padding: '10px 12px',
              borderBottom: '1px solid #374151',
              flexShrink: 0,
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '8px',
                fontFamily: '"Press Start 2P", monospace',
                color: '#EC4899',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                <span style={{ fontSize: '12px' }}>💬</span>
                STREAM CHAT
              </h3>
            </div>

            {/* Chat messages - scrollable */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              {streamerMessages.length === 0 ? (
                <div style={{
                  padding: '16px',
                  textAlign: 'center',
                  color: '#6B7280',
                  fontSize: '8px',
                  fontFamily: '"Press Start 2P", monospace',
                }}>
                  Waiting...
                </div>
              ) : (
                streamerMessages.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      padding: '8px 10px',
                      background: msg.type === 'excitement' 
                        ? 'rgba(74, 222, 128, 0.1)'
                        : msg.type === 'frustration'
                          ? 'rgba(239, 68, 68, 0.1)'
                          : 'rgba(236, 72, 153, 0.08)',
                      borderRadius: '4px',
                      borderLeft: `3px solid ${
                        msg.type === 'excitement' ? '#4ADE80'
                        : msg.type === 'frustration' ? '#EF4444'
                        : '#EC4899'
                      }`,
                    }}
                  >
                    <p style={{
                      margin: 0,
                      fontSize: '11px',
                      lineHeight: 1.4,
                      color: '#E5E7EB',
                    }}>
                      {msg.text}
                    </p>
                    <span style={{
                      fontSize: '7px',
                      color: '#6B7280',
                      marginTop: '3px',
                      display: 'block',
                    }}>
                      {msg.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
