import { useEffect, useLayoutEffect, useRef } from 'react';

interface QuestionKeyboardShortcutsOptions {
  optionCount: number;
  onOptionSelect: (index: number) => void;
  onEnter: () => void;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
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

      if (/^[1-4]$/.test(event.key)) {
        const optionIndex = Number(event.key) - 1;
        if (optionIndex >= options.optionCount) return;

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
