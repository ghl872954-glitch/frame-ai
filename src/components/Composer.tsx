'use client';

/** 打字入口。语音不是万能的 —— 吵的地方、要贴代码的时候，还是键盘好使。 */

import { useState, type KeyboardEvent } from 'react';

import { useVox, useTranslator } from '@/lib/store';

export function Composer() {
  const send = useVox((state) => state.send);
  const busy = useVox((state) => state.session === 'thinking');
  const t = useTranslator();
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    setValue('');
    void send(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <textarea
        rows={1}
        value={value}
        placeholder={t('composer.placeholder')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label={t('composer.placeholder')}
      />
      <button
        type="button"
        className="btn btn-primary"
        onClick={submit}
        disabled={!value.trim() || busy}
      >
        {t('composer.send')}
      </button>
    </div>
  );
}
