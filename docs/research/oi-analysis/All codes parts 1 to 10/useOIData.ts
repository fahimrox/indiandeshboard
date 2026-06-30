import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  OIAnalysisState, 
  OITimelinePoint, 
  OISummary, 
  S_R_Zone, 
  AIDecision, 
  OIChainRow,
  OptionData,
  BuildupType
} from '../types/oi.types';
import { 
  calculatePCR, 
  calculateMaxPain, 
  detectSRZones, 
  computeDecisionEngine, 
  calculateBuildup, 
  isChurn 
} from '../lib/oi-calculations';

/**
 * Generate highly realistic intraday timeline data (from 9:15 AM to 3:30 PM in 15-min intervals).
 * In production, this would fetch from FastAPI backend storing historical option chain ticks.
 */
function generateTimelineData(symbol: string, expiry: string): OITimelinePoint[] {
  const points: OITimelinePoint[] = [];
  const baseSpot = symbol === 'NIFTY' ? 24000 : symbol === 'BANKNIFTY' ? 52000 : 1000;
  const strikes = symbol === 'NIFTY' 
    ? Array.from({ length: 21 }, (_, i) => 23500 + i * 50)
    : Array.from({ length: 21 }, (_, i) => 51000 + i * 100);

  const times = [
    '09:15 AM', '09:30 AM', '09:45 AM', '10:00 AM', '10:15 AM', '10:30 AM', '10:45 AM',
    '11:00 AM', '11:15 AM', '11:30 AM', '11:45 AM', '12:00 PM', '12:15 PM', '12:30 PM',
    '12:45 PM', '01:00 PM', '01:15 PM', '01:30 PM', '01:45 PM', '02:00 PM', '02:15 PM',
    '02:30 PM', '02:45 PM', '03:00 PM', '03:15 PM', '03:30 PM'
  ];

  times.forEach((time, index) => {
    // Generate trending spot price
    const progress = index / (times.length - 1);
    const spotNoise = Math.sin(progress * Math.PI * 2) * 80 + (progress * 120); // trend up with wave
    const spot = Math.round((baseSpot + spotNoise) * 100) / 100;

    // Generate option chain at this specific point in time
    const chain: OIChainRow[] = strikes.map(strike => {
      const isATM = Math.abs(strike - spot) <= 25;
      
      // Calculate realistic base OIs
      const distFromSpot = (strike - spot) / 50;
      const baseCallOI = Math.max(10000, Math.round(1500000 * Math.exp(-Math.abs(distFromSpot) / 4)));
      const basePutOI = Math.max(10000, Math.round(1500000 * Math.exp(-Math.abs(distFromSpot) / 4)));

      // Add progression over time
      const timeFactor = 1 + progress * 0.8;
      let ceOI = Math.round(baseCallOI * timeFactor);
      let peOI = Math.round(basePutOI * timeFactor);

      // Skew calls on high strikes, puts on low strikes over time
      if (strike > spot) {
        ceOI = Math.round(ceOI * (1 + progress * 0.4));
      } else {
        peOI = Math.round(peOI * (1 + progress * 0.4));
      }

      // Daily Change in OI (signed)
      const ceOIChange = Math.round(ceOI * 0.2 * Math.sin(progress * Math.PI));
      const peOIChange = Math.round(peOI * 0.3 * Math.cos(progress * Math.PI));

      // Price & Changes
      const cePrice = Math.max(1, Math.round(150 * Math.exp(-distFromSpot / 2)));
      const pePrice = Math.max(1, Math.round(150 * Math.exp(distFromSpot / 2)));
      
      const cePriceChange = Math.round(cePrice * 0.1 * (progress - 0.5));
      const pePriceChange = Math.round(pePrice * 0.1 * (0.5 - progress));

      const ceVolume = Math.round(ceOI * 0.8);
      const peVolume = Math.round(peOI * 0.8);

      const ceBuildup = calculateBuildup(cePriceChange, ceOIChange);
      const peBuildup = calculateBuildup(pePriceChange, peOIChange);

      const ceData: OptionData = {
        oi: ceOI,
        oiChange: ceOIChange,
        volume: ceVolume,
        iv: 12.5 + Math.random() * 2,
        delta: Math.max(-1, Math.min(1, parseFloat((1 / (1 + Math.exp(distFromSpot))).toFixed(2)))),
        gamma: Math.max(0, parseFloat((0.02 * Math.exp(-Math.pow(distFromSpot, 2) / 4)).toFixed(4))),
        theta: parseFloat((-2.5 - Math.random() * 2).toFixed(2)),
        price: cePrice,
        priceChange: cePriceChange,
        buildup: ceBuildup
      };

      const peData: OptionData = {
        oi: peOI,
        oiChange: peOIChange,
        volume: peVolume,
        iv: 13.0 + Math.random() * 2,
        delta: Math.max(-1, Math.min(1, parseFloat((-1 / (1 + Math.exp(-distFromSpot))).toFixed(2)))),
        gamma: Math.max(0, parseFloat((0.02 * Math.exp(-Math.pow(distFromSpot, 2) / 4)).toFixed(4))),
        theta: parseFloat((-2.2 - Math.random() * 2).toFixed(2)),
        price: pePrice,
        priceChange: pePriceChange,
        buildup: peBuildup
      };

      const rowPCR = ceOI > 0 ? parseFloat((peOI / ceOI).toFixed(2)) : 0;

      return {
        strike,
        ce: ceData,
        pe: peData,
        isATM,
        pcr: rowPCR,
        notionalDiff: (peOI - ceOI) * 75, // NIFTY lot size model
        moneyFlow: (peOIChange * pePrice - ceOIChange * cePrice) * 75,
        supportRank: 0,
        resistanceRank: 0,
        aiScore: Math.round((rowPCR - 1) * 50)
      };
    });

    // Rank supports & resistances at this time step
    const sortedPuts = [...chain].sort((a, b) => b.pe.oi - a.pe.oi);
    const sortedCalls = [...chain].sort((a, b) => b.ce.oi - a.ce.oi);
    
    chain.forEach(row => {
      row.supportRank = sortedPuts.findIndex(r => r.strike === row.strike) + 1;
      row.resistanceRank = sortedCalls.findIndex(r => r.strike === row.strike) + 1;
    });

    // Aggregated variables
    const totalCallOI = chain.reduce((acc, row) => acc + row.ce.oi, 0);
    const totalPutOI = chain.reduce((acc, row) => acc + row.pe.oi, 0);
    const callOIChange = chain.reduce((acc, row) => acc + row.ce.oiChange, 0);
    const putOIChange = chain.reduce((acc, row) => acc + row.pe.oiChange, 0);
    const pcrValue = calculatePCR(totalPutOI, totalCallOI);

    const strikesArr = strikes;
    const ceOIsObj = chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.ce.oi }), {});
    const peOIsObj = chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.pe.oi }), {});
    const maxPain = calculateMaxPain(strikesArr, ceOIsObj, peOIsObj);

    const zones = detectSRZones(strikesArr, ceOIsObj, peOIsObj, spot);
    const decision = computeDecisionEngine(pcrValue, callOIChange, putOIChange, spot, maxPain, zones);

    points.push({
      time,
      spot,
      pcr: pcrValue,
      maxPain,
      totalCallOI,
      totalPutOI,
      callOIChange,
      putOIChange,
      bias: decision.bias,
      confidence: decision.confidence,
      chain
    });
  });

  return points;
}

export function useOIData(state: OIAnalysisState) {
  // 1. Fetch live historical timeline series from FastAPI (simulated here via React Query hook)
  const { data: timeline = [], isLoading, refetch } = useQuery<OITimelinePoint[]>({
    queryKey: ['oiTimeline', state.symbol, state.expiry],
    queryFn: async () => {
      // In production, fetch via axios/fetch:
      // const res = await fetch(`/api/v1/oi/timeline?symbol=${state.symbol}&expiry=${state.expiry}`);
      // return res.json();
      return generateTimelineData(state.symbol, state.expiry);
    },
    refetchInterval: state.mode === 'Live' ? 15000 : false, // Poll every 15 seconds in Live mode
    staleTime: 5000,
  });

  // 2. State for controlling replay and scrub positioning
  const [timelineIndex, setTimelineIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 4x

  // Reset slider index to last point when timeline loads/refreshes in Live mode
  useEffect(() => {
    if (state.mode === 'Live' && timeline.length > 0) {
      setTimelineIndex(timeline.length - 1);
    }
  }, [timeline, state.mode]);

  // Autoplay replay engine loop
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (isPlaying && timeline.length > 0) {
      intervalId = setInterval(() => {
        setTimelineIndex(prev => {
          if (prev >= timeline.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1500 / playbackSpeed);
    }
    return () => clearInterval(intervalId);
  }, [isPlaying, timeline.length, playbackSpeed]);

  // Active data point represents either the selected slider point or the latest live tick
  const activePoint = useMemo<OITimelinePoint | null>(() => {
    if (timeline.length === 0) return null;
    const index = Math.min(timelineIndex, timeline.length - 1);
    return timeline[index];
  }, [timeline, timelineIndex]);

  // Derive Top Ribbon Summary Metrics based on current active point
  const summary = useMemo<OISummary | null>(() => {
    if (!activePoint) return null;

    const strikes = activePoint.chain.map(r => r.strike);
    const ceOIsObj = activePoint.chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.ce.oi }), {});
    const peOIsObj = activePoint.chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.pe.oi }), {});
    const maxPain = calculateMaxPain(strikes, ceOIsObj, peOIsObj);

    // Support / Resistance
    const zones = detectSRZones(strikes, ceOIsObj, peOIsObj, activePoint.spot);
    const decision = computeDecisionEngine(
      activePoint.pcr, 
      activePoint.callOIChange, 
      activePoint.putOIChange, 
      activePoint.spot, 
      maxPain, 
      zones
    );

    // Highest OIs
    const highestCallOI = [...activePoint.chain].sort((a, b) => b.ce.oi - a.ce.oi)[0]?.strike || 0;
    const highestPutOI = [...activePoint.chain].sort((a, b) => b.pe.oi - a.pe.oi)[0]?.strike || 0;

    const highestCallWriting = [...activePoint.chain].sort((a, b) => b.ce.oiChange - a.ce.oiChange)[0]?.strike || 0;
    const highestPutWriting = [...activePoint.chain].sort((a, b) => b.pe.oiChange - a.pe.oiChange)[0]?.strike || 0;

    return {
      spotPrice: activePoint.spot,
      spotChange: parseFloat((activePoint.spot * 0.005).toFixed(2)), // simulated
      spotChangePercent: 0.5, // simulated
      atmStrike: strikes.reduce((prev, curr) => Math.abs(curr - activePoint.spot) < Math.abs(prev - activePoint.spot) ? curr : prev, strikes[0]),
      pcr: activePoint.pcr,
      pcrTrend: activePoint.pcr > 1.1 ? 'up' : activePoint.pcr < 0.8 ? 'down' : 'flat',
      maxPain,
      highestCallOIStrike: highestCallOI,
      highestPutOIStrike: highestPutOI,
      highestCallWritingStrike: highestCallWriting,
      highestPutWritingStrike: highestPutWriting,
      marketBias: decision.bias,
      confidence: decision.confidence,
      aiSummary: decision.trapDetected 
        ? (decision.trapDetails || '') 
        : `Strong ${decision.bias} build-up noticed with High Put/Call support dynamic. Smart money concentrating around ${highestPutOI} PE support.`,
      lastUpdate: activePoint.time,
      dataSource: 'FYERS Option Chain'
    };
  }, [activePoint]);

  // S/R Zones Derived for current view
  const srZones = useMemo<S_R_Zone[]>(() => {
    if (!activePoint) return [];
    const strikes = activePoint.chain.map(r => r.strike);
    const ceOIsObj = activePoint.chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.ce.oi }), {});
    const peOIsObj = activePoint.chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.pe.oi }), {});
    return detectSRZones(strikes, ceOIsObj, peOIsObj, activePoint.spot);
  }, [activePoint]);

  // AI Decision details
  const aiDecision = useMemo<AIDecision | null>(() => {
    if (!activePoint || !summary) return null;
    const strikes = activePoint.chain.map(r => r.strike);
    const ceOIsObj = activePoint.chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.ce.oi }), {});
    const peOIsObj = activePoint.chain.reduce((acc, row) => ({ ...acc, [row.strike]: row.pe.oi }), {});
    return computeDecisionEngine(
      activePoint.pcr, 
      activePoint.callOIChange, 
      activePoint.putOIChange, 
      activePoint.spot, 
      summary.maxPain, 
      srZones
    );
  }, [activePoint, summary, srZones]);

  return {
    timeline,
    isLoading,
    refetch,
    timelineIndex,
    setTimelineIndex,
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    activePoint,
    summary,
    srZones,
    aiDecision
  };
}
