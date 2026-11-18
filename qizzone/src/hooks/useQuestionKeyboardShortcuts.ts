import { useEffect, useLayoutEffect, useRef } from 'react';

interface QuestionKeyboardShortcutsOptions {
  optionCount: number;
  onOptionSelect: (index: number) => void;
  onEnter: () => void;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

export function getShortcutOptionIndex(key: string, optionCount: number): number | undefined {
  if (!/^[1-5]$/.test(key)) return undefined;
  const index = Number(key) - 1;
  return index < optionCount ? index : undefined;
}

export function useQuestionKeyboardShortcuts({
  optionCount,
  onOptionSelect,
  onEnter,
  onPrevious,
  onNext,
  disabled = false,
}: QuestionKeyboardShortcutsOptions) {
  const optionsRef = useRef({ optionCount, onOptionSelect, onEnter, onPrevious, onNext, disabled });

  useLayoutEffect(() => {
    optionsRef.current = { optionCount, onOptionSelect, onEnter, onPrevious, onNext, disabled };
  }, [optionCount, onOptionSelect, onEnter, onPrevious, onNext, disabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const options = optionsRef.current;
      if (
        options.disabled
        || event.defaultPrevented
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || event.shiftKey
        || (event.repeat && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      ) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
      )) {
        return;
      }

      const optionIndex = getShortcutOptionIndex(event.key, options.optionCount);
      if (optionIndex !== undefined) {
        event.preventDefault();
        options.onOptionSelect(optionIndex);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        options.onEnter();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        options.onPrevious();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        options.onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

export default useQuestionKeyboardShortcuts;
