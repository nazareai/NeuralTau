'use client';

import { useEffect, useState, useRef } from 'react';
import type { GameState, GameAction, EmotionalState, EmotionType } from '@tau/shared';

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

export default function Dashboard() {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [currentDecision, setCurrentDecision] = useState<Decision | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<'fast' | 'advanced'>('fast');
  const [emotionalState, setEmotionalState] = useState<EmotionalState | null>(null);
  const [testTimer, setTestTimer] = useState<{ active: boolean; startTime: number; duration: number }>({ active: false, startTime: 0, duration: 5 * 60 * 1000 }); // 5 minutes
  const [timerDisplay, setTimerDisplay] = useState('5:00');
  const [activity, setActivity] = useState<{ type: string; item?: string; active: boolean }>({ type: 'idle', active: false });
  const [heldItem, setHeldItem] = useState<{ name: string | null; displayName: string | null; action: 'idle' | 'mining' | 'attacking' | 'eating' | 'placing' }>({ name: null, displayName: null, action: 'idle' });
  const [viewerPort, setViewerPort] = useState(3007);
  const [itemPickups, setItemPickups] = useState<{ id: number; itemName: string; displayName: string; count: number }[]>([]);
  const pickupIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);

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
            TAU
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

  return (
    <div style={{
      height: '100vh',
      background: 'linear-gradient(180deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
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
              TAU
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

        {/* Test Timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {testTimer.active ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 20px',
              background: timerDisplay === '0:00'
                ? 'linear-gradient(135deg, rgba(74, 222, 128, 0.3) 0%, rgba(34, 197, 94, 0.2) 100%)'
                : 'linear-gradient(135deg, rgba(251, 191, 36, 0.3) 0%, rgba(245, 158, 11, 0.2) 100%)',
              border: `3px solid ${timerDisplay === '0:00' ? '#4ADE80' : '#FBBF24'}`,
              borderRadius: '4px',
              animation: timerDisplay === '0:00' ? 'glow 1s ease-in-out infinite' : 'none',
            }}>
              <span style={{
                fontSize: '14px',
                fontFamily: '"Press Start 2P", monospace',
                color: timerDisplay === '0:00' ? '#4ADE80' : '#FBBF24',
                textShadow: '1px 1px 0 #000',
              }}>
                {timerDisplay === '0:00' ? 'DONE!' : timerDisplay}
              </span>
              <button
                onClick={stopTestTimer}
                style={{
                  background: 'rgba(239, 68, 68, 0.8)',
                  border: '2px solid #EF4444',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '8px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#fff',
                  cursor: 'pointer',
                  textShadow: '1px 1px 0 #000',
                }}
              >
                STOP
              </button>
            </div>
          ) : (
            <button
              onClick={startTestTimer}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.2) 100%)',
                border: '3px solid #3B82F6',
                borderRadius: '4px',
                fontSize: '10px',
                fontFamily: '"Press Start 2P", monospace',
                color: '#3B82F6',
                cursor: 'pointer',
                textShadow: '1px 1px 0 #000',
              }}
            >
              5MIN TEST
            </button>
          )}
        </div>

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
                        color: minecraftState.time === 'day' ? '#FEF08A' : '#60A5FA',
                        textShadow: '1px 1px 0 #000',
                      }}>
                        {minecraftState.time === 'day' ? '☀ DAY' : '🌙 NIGHT'}
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
                {thinkingMode === 'advanced' ? 'DEEP THINK' : 'PROCESSING'}
              </span>
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
          gap: '12px',
          height: '100%',
          minHeight: 0, // Important for flex overflow
        }}>
          {/* Current Action - Fixed height, doesn't scroll */}
          {currentDecision && (
            <div style={{
              flexShrink: 0,
              position: 'relative',
              background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '4px',
                background: 'repeating-linear-gradient(90deg, #22C55E 0px, #22C55E 8px, transparent 8px, transparent 16px)',
              }} />
              <div style={{ padding: '16px' }}>
                <h3 style={{
                  margin: '0 0 12px 0',
                  fontSize: '10px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: '#22C55E',
                  textShadow: '1px 1px 0 #000',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{ fontSize: '16px' }}>⚡</span>
                  CURRENT ACTION
                </h3>
                <p style={{
                  fontSize: '12px',
                  lineHeight: 1.6,
                  color: '#E5E7EB',
                  margin: '0 0 12px 0',
                }}>
                  {currentDecision.reasoning}
                </p>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
                  color: '#fff',
                  padding: '10px 16px',
                  border: '3px solid #4ADE80',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontFamily: '"Press Start 2P", monospace',
                  textShadow: '1px 1px 0 #000',
                  boxShadow: '0 4px 0 #15803D',
                }}>
                  <span>→</span>
                  {currentDecision.action.type} {currentDecision.action.target}
                </div>
              </div>
            </div>
          )}

          {/* Emotion Panel - Shows current emotional state */}
          {emotionalState && (
            <div style={{
              flexShrink: 0,
              position: 'relative',
              background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '4px',
                background: `repeating-linear-gradient(90deg, ${EMOTION_COLORS[emotionalState.dominant]} 0px, ${EMOTION_COLORS[emotionalState.dominant]} 8px, transparent 8px, transparent 16px)`,
              }} />
              <div style={{ padding: '16px' }}>
                <h3 style={{
                  margin: '0 0 12px 0',
                  fontSize: '10px',
                  fontFamily: '"Press Start 2P", monospace',
                  color: EMOTION_COLORS[emotionalState.dominant],
                  textShadow: '1px 1px 0 #000',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{ fontSize: '20px' }}>{EMOTION_EMOJIS[emotionalState.dominant]}</span>
                  {emotionalState.dominant.toUpperCase()}
                </h3>

                {/* Emotion intensity bar */}
                <div style={{
                  height: '12px',
                  background: '#1F2937',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  marginBottom: '12px',
                  border: '2px solid #374151',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${emotionalState.dominantIntensity}%`,
                    background: `linear-gradient(90deg, ${EMOTION_COLORS[emotionalState.dominant]}88 0%, ${EMOTION_COLORS[emotionalState.dominant]} 100%)`,
                    transition: 'width 0.5s ease-out',
                  }} />
                </div>

                {/* Expression/thought bubble */}
                {emotionalState.expression && (
                  <div style={{
                    background: 'rgba(0,0,0,0.4)',
                    padding: '10px 12px',
                    borderRadius: '4px',
                    border: '2px solid #374151',
                    position: 'relative',
                  }}>
                    <span style={{
                      fontSize: '11px',
                      color: '#E5E7EB',
                      fontStyle: 'italic',
                      lineHeight: 1.4,
                    }}>
                      "{emotionalState.expression}"
                    </span>
                  </div>
                )}

                {/* Mood indicator */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '10px',
                }}>
                  {['negative', 'neutral', 'positive'].map((mood) => (
                    <div
                      key={mood}
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: emotionalState.mood === mood
                          ? (mood === 'positive' ? '#4ADE80' : mood === 'negative' ? '#EF4444' : '#FBBF24')
                          : '#374151',
                        boxShadow: emotionalState.mood === mood
                          ? `0 0 8px ${mood === 'positive' ? '#4ADE80' : mood === 'negative' ? '#EF4444' : '#FBBF24'}`
                          : 'none',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Activity Log - Takes remaining space and scrolls */}
          <div style={{
            flex: 1,
            minHeight: 0, // Critical for flex overflow to work
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
              height: '4px',
              background: 'repeating-linear-gradient(90deg, #FBBF24 0px, #FBBF24 8px, transparent 8px, transparent 16px)',
            }} />
            <div style={{
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
            }}>
              <h3 style={{
                margin: '0 0 16px 0',
                fontSize: '10px',
                fontFamily: '"Press Start 2P", monospace',
                color: '#FBBF24',
                textShadow: '1px 1px 0 #000',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: '16px' }}>📜</span>
                ACTIVITY LOG
              </h3>

              <div style={{
                flex: 1,
                overflowY: 'auto',
                minHeight: 0,
                paddingRight: '4px',
              }}>
                {decisions.length === 0 ? (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                  }}>
                    <span style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}>🌿</span>
                    <span style={{
                      fontSize: '10px',
                      fontFamily: '"Press Start 2P", monospace',
                      color: '#6B7280',
                    }}>
                      NO ACTIVITY
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {decisions.map((decision, index) => (
                      <div
                        key={index}
                        style={{
                          padding: '12px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '2px solid #374151',
                          borderLeft: '4px solid #FBBF24',
                        }}
                      >
                        <div style={{
                          fontSize: '8px',
                          fontFamily: '"Press Start 2P", monospace',
                          color: '#6B7280',
                          marginBottom: '8px',
                        }}>
                          {decision.timestamp.toLocaleTimeString()}
                        </div>
                        <p style={{
                          fontSize: '11px',
                          lineHeight: 1.5,
                          color: '#D1D5DB',
                          margin: '0 0 8px 0',
                        }}>
                          {decision.reasoning}
                        </p>
                        <div style={{
                          fontSize: '10px',
                          fontFamily: '"Press Start 2P", monospace',
                          color: '#60A5FA',
                          background: 'rgba(96, 165, 250, 0.1)',
                          padding: '6px 10px',
                          border: '2px solid rgba(96, 165, 250, 0.3)',
                          display: 'inline-block',
                        }}>
                          → {decision.action.type} {decision.action.target}
                        </div>
                        {results[index] && (
                          <div style={{
                            fontSize: '10px',
                            color: '#9CA3AF',
                            marginTop: '8px',
                            paddingTop: '8px',
                            borderTop: '1px dashed #374151',
                            fontStyle: 'italic',
                          }}>
                            {results[index].outcome}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
