'use client';
import { useEffect, useRef, useState } from 'react';

export function useNarration(text: string, identity: string, playing: boolean, onEnded: () => void, onFailure: () => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const callbacks = useRef({ onEnded, onFailure });
  callbacks.current = { onEnded, onFailure };
  const [status, setStatus] = useState('点击播放后合成语音 · 按段计费');
  const [error, setError] = useState('');
  const play = useRef(false);
  play.current = playing;
  const [retry, setRetry] = useState(0);
  // Keyed by lesson, frame and exact narration. Navigation invalidates every old callback.
  useEffect(() => {
    let stale = false;
    const controller = new AbortController();
    const element = new Audio();
    audio.current = element;
    let started = false;
    let chunks: string[] = [];
    let part = 0;
    const fail = (message: string) => {
      if (stale) return;
      setError(message); setStatus('语音已停止'); callbacks.current.onFailure();
    };
    const resume = () => {
      if (!play.current || stale || !element.src) return;
      void element.play().then(() => { if (!stale && play.current) setStatus('正在讲解 · 音频结束后进入下一步'); })
        .catch(() => { if (play.current) fail('浏览器未能播放音频，请点击“重试语音”。'); });
    };
    async function load() {
      element.removeAttribute('src');
      element.load();
      setStatus('正在合成语音…');
      try {
        const response = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunks[part] }), signal: controller.signal });
        const result = await response.json() as { url?: string; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message || '语音合成失败');
        if (!result.url) throw new Error('语音服务未返回音频');
        if (stale) return;
        element.src = result.url;
        setStatus(play.current ? '音频加载中…' : '已暂停');
        resume();
      } catch (e) { if (!stale) fail(e instanceof Error ? e.message : '语音合成失败'); }
    }
    element.onended = () => {
      if (stale || !play.current) return;
      part++;
      if (part < chunks.length) void load();
      else { started = false; part = 0; element.removeAttribute('src'); setStatus('本步讲解结束'); callbacks.current.onEnded(); }
    };
    element.onerror = () => fail('音频加载失败，请重试语音。');
    const control = () => {
      if (!play.current) { element.pause(); if (started) setStatus('已暂停'); return; }
      if (!started) {
        started = true;
        chunks = text.match(/[\s\S]{1,500}/g) || [text];
        void load();
      } else resume();
    };
    controlRef.current = control;
    setError(''); setStatus('点击播放后合成语音 · 按段计费');
    control();
    return () => { stale = true; controller.abort(); element.onended = null; element.onerror = null; element.pause(); element.removeAttribute('src'); element.load(); audio.current = null; };
  }, [text, identity, retry]);
  const controlRef = useRef<() => void>(() => {});
  useEffect(() => { controlRef.current(); }, [playing]);
  return { status, error, retry: () => setRetry(n => n + 1) };
}
