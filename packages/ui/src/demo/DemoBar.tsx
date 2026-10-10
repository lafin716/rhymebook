import { ChevronDown, ChevronUp, Clapperboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRuntime } from '../app/runtime';
import { exitDemo, runScenario, SCENARIOS } from '../app/scenarios';
import { cn } from '../lib/cn';

const COLLAPSE_KEY = 'branch.demobar.collapsed';

function hashScenario(): string | null {
  const m = /scenario=([\w-]+)/.exec(window.location.hash);
  return m?.[1] ?? null;
}

/** 개발 서버 전용 시나리오 점프 메뉴. `#scenario=<id>`로 직접 진입할 수 있다 */
export function DemoBar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [current, setCurrent] = useState<string | null>(hashScenario);
  const demo = useRuntime((s) => s.demo);

  useEffect(() => {
    const apply = () => {
      const id = hashScenario();
      if (id && runScenario(id)) setCurrent(id);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  const go = (id: string) => {
    if (hashScenario() === id) runScenario(id);
    else window.location.hash = `scenario=${id}`;
    setCurrent(id);
  };

  const real = () => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    exitDemo();
    setCurrent(null);
  };

  const hint = SCENARIOS.find((s) => s.id === current)?.hint;

  return (
    <div className="shrink-0 border-b border-dashed border-warn/40 bg-warn-soft text-[12.5px]">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-warn hover:bg-warn/10"
        >
          <Clapperboard size={14} />
          <span>데모</span>
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        {!collapsed && (
          <div className="scroll-thin flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.hint}
                onClick={() => go(s.id)}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-0.5 whitespace-nowrap',
                  current === s.id
                    ? 'border-warn bg-warn text-white dark:text-black'
                    : 'border-warn/30 bg-surface/60 text-fg-2 hover:border-warn/60',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {collapsed && hint && <span className="truncate text-fg-2">{hint}</span>}
        <button
          type="button"
          onClick={real}
          disabled={!demo}
          title="데모를 끝내고 실제 provider(API 키)로 동작"
          className={cn(
            'ml-auto shrink-0 rounded-full border px-2.5 py-0.5 whitespace-nowrap',
            demo ? 'border-warn/30 bg-surface/60 text-fg-2 hover:border-warn/60' : 'border-ok/40 bg-ok/10 font-semibold text-ok',
          )}
        >
          {demo ? '실제 모드로' : '실제 모드'}
        </button>
      </div>
      {!collapsed && hint && <div className="truncate px-3 pb-1.5 text-fg-2">▸ {hint}</div>}
    </div>
  );
}
