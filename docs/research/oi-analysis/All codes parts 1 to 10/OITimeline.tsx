import React from 'react';
import { Play, Pause, FastForward, SkipBack, Calendar, Clock } from 'lucide-react';
import { OITimelinePoint } from '../types/oi.types';

interface OITimelineProps {
  timeline: OITimelinePoint[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
}

export const OITimeline: React.FC<OITimelineProps> = React.memo(({
  timeline,
  currentIndex,
  onIndexChange,
  isPlaying,
  onPlayPause,
  speed,
  onSpeedChange
}) => {
  if (timeline.length === 0) return null;

  const currentPoint = timeline[currentIndex];

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onIndexChange(parseInt(e.target.value, 10));
  };

  return (
    <div className="w-full bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-4 select-none">
      {/* Top Controller Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span>SESSION TIMELINE</span>
          </div>
          <div className="h-4 w-[1px] bg-zinc-800"></div>
          {/* Active indicator */}
          <div className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-xs font-bold text-zinc-100 tabular-nums">
            {currentPoint?.time || '09:15 AM'}
          </div>
          {currentPoint && (
            <span className="text-[11px] text-zinc-500 font-medium">
              Spot at this time: <b className="text-zinc-300 font-semibold">{currentPoint.spot.toFixed(2)}</b>
            </span>
          )}
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          {/* Skip Back to Start */}
          <button
            onClick={() => onIndexChange(0)}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition duration-150"
            title="Jump to market open (09:15 AM)"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* Play/Pause Trigger */}
          <button
            onClick={onPlayPause}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase rounded border transition duration-150 ${
              isPlaying
                ? 'bg-amber-950/40 border-amber-600/50 text-amber-500 hover:bg-amber-950/60'
                : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3 h-3 fill-amber-500" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-zinc-200" />
                <span>Replay</span>
              </>
            )}
          </button>

          {/* Speed Multiplier Button toggle */}
          <button
            onClick={() => {
              if (speed === 1) onSpeedChange(2);
              else if (speed === 2) onSpeedChange(4);
              else onSpeedChange(1);
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded transition duration-150"
            title="Adjust replay speed"
          >
            <FastForward className="w-3 h-3 text-zinc-400" />
            <span className="tabular-nums">{speed}x</span>
          </button>
        </div>
      </div>

      {/* Modern Slider Scrubber & Markers */}
      <div className="relative w-full pt-1 pb-2">
        <input
          type="range"
          min="0"
          max={timeline.length - 1}
          value={currentIndex}
          onChange={handleSliderChange}
          className="w-full h-1.5 bg-zinc-900 rounded-lg appearance-none cursor-pointer accent-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500/50"
        />

        {/* Tick labels beneath slider */}
        <div className="flex justify-between text-[10px] font-bold text-zinc-600 mt-1 select-none">
          <span>09:15 AM</span>
          <span className="hidden sm:inline">10:30 AM</span>
          <span className="hidden sm:inline">12:00 PM</span>
          <span className="hidden sm:inline">01:30 PM</span>
          <span className="hidden sm:inline">03:00 PM</span>
          <span>03:30 PM</span>
        </div>
      </div>
    </div>
  );
});

OITimeline.displayName = 'OITimeline';
