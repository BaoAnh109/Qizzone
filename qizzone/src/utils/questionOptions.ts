import { OPTION_IDS, type OptionId, type OptionItem } from "@/types/quiz";

export function addQuestionOption(options: OptionItem[]): OptionItem[] {
  if (options.length >= OPTION_IDS.length) return options;

  const nextId = OPTION_IDS.find(id => !options.some(option => option.id === id));
  if (!nextId) return options;

  return [...options, { id: nextId, content: "" }]
    .sort((left, right) => OPTION_IDS.indexOf(left.id) - OPTION_IDS.indexOf(right.id));
}

export function removeQuestionOption(
  options: OptionItem[],
  correctAnswers: OptionId[],
  optionId: OptionId,
): { options: OptionItem[]; correctAnswers: OptionId[] } {
  if (options.length <= 2 || !options.some(option => option.id === optionId)) {
    return { options, correctAnswers };
  }

  return {
    options: options.filter(option => option.id !== optionId),
    correctAnswers: correctAnswers.filter(answer => answer !== optionId),
  };
}
