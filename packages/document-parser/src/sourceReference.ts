import type { ExtractionResult } from "@qizzone/domain";
import type { DocumentIR, DocumentIRBlock } from "@qizzone/domain";

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function createBlockMatcher(blocks: DocumentIRBlock[]) {
  const normalizedBlocks = new Map<DocumentIRBlock, string>();
  blocks.forEach(block => normalizedBlocks.set(block, normalizeForMatch(block.normalizedText || block.text || "")));
  const normalizedQueries = new Map<string, string>();
  const getQuery = (query: string) => {
    let normalized = normalizedQueries.get(query);
    if (normalized === undefined) {
      normalized = normalizeForMatch(query);
      normalizedQueries.set(query, normalized);
    }
    return normalized;
  };

  return {
    getBlockText: (block: DocumentIRBlock) => normalizedBlocks.get(block) || "",
    matches: (block: DocumentIRBlock, query: string) => {
      const source = normalizedBlocks.get(block) || "";
      const target = getQuery(query);
      if (source.length < 6 || target.length < 6) return false;
      return source.includes(target) || (target.length >= 24 && target.includes(source));
    },
  };
}

function verticalDistance(first: DocumentIRBlock, second: DocumentIRBlock): number | undefined {
  if (!first.bbox || !second.bbox || first.sourceRef.page !== second.sourceRef.page) return undefined;
  return Math.max(0, first.bbox[1] - second.bbox[3], second.bbox[1] - first.bbox[3]);
}

function keepNearestOptionMatches(
  candidates: DocumentIRBlock[],
  promptBlocks: DocumentIRBlock[],
  optionId: string,
  matcher: ReturnType<typeof createBlockMatcher>,
): DocumentIRBlock[] {
  const positionedCandidates = candidates.filter(block => block.bbox && block.sourceRef.page !== undefined);
  const positionedPrompts = promptBlocks.filter(block => block.bbox && block.sourceRef.page !== undefined);
  if (!positionedCandidates.length || !positionedPrompts.length) return candidates;

  const labelPattern = new RegExp("(?:^|\\s)" + optionId + "[.)]", "iu");
  const distances = positionedCandidates.map(block => ({
    block,
    distance: Math.min(...positionedPrompts.flatMap(prompt => {
      const distance = verticalDistance(block, prompt);
      if (distance === undefined) return [];
      const appearsBelowPrompt = Boolean(block.bbox && prompt.bbox && block.bbox[3] <= prompt.bbox[1]);
      const text = matcher.getBlockText(block);
      const isLabeledOption = labelPattern.test(text);
      return [Math.max(0, distance + (appearsBelowPrompt ? 0 : 36) - (isLabeledOption ? 16 : 0))];
    }), Infinity),
  })).filter(candidate => Number.isFinite(candidate.distance));
  if (!distances.length) return candidates;

  // Repeated answer text elsewhere in a PDF (for example, an option reused by
  // a later question) must not become a source reference for this question.
  // Keep only the closest vertical cluster on the page nearest its prompt.
  const bestPage = distances.reduce((best, current) => current.distance < best.distance ? current : best).block.sourceRef.page;
  const samePage = distances.filter(candidate => candidate.block.sourceRef.page === bestPage);
  const nearestDistance = Math.min(...samePage.map(candidate => candidate.distance));
  const matched = samePage
    .filter(candidate => candidate.distance <= nearestDistance + 20)
    .map(candidate => candidate.block);
  const unpositioned = candidates.filter(block => !block.bbox || block.sourceRef.page === undefined);
  return [...matched, ...unpositioned];
}

/** Links extracted text back to the native blocks used by the source viewer. */
export function attachQuestionSourceReferences(result: ExtractionResult, documentIR: DocumentIR): ExtractionResult {
  const blocks = [...documentIR.pages.flatMap(page => page.blocks), ...(documentIR.flowBlocks || [])];
  const matcher = createBlockMatcher(blocks);
  const questions = result.questions.map(question => {
    const promptBlocks = blocks.filter(block => matcher.matches(block, question.content));
    const optionBlocks = question.options.map(option => keepNearestOptionMatches(
      blocks.filter(block => matcher.matches(block, option.content)),
      promptBlocks,
      option.id,
      matcher,
    ));
    const options = question.options.map((option, index) => ({
      ...option,
      sourceRefs: optionBlocks[index].map(block => block.id),
    }));
    const sourceBlocks = [...new Map([...promptBlocks, ...optionBlocks.flat()].map(block => [block.id, block])).values()];
    const sourceRefs = sourceBlocks.map(block => block.id);
    const answerEvidence = (question.answerEvidence || []).map(evidence => {
      const optionTexts = evidence.optionIds
        .map(id => question.options.find(option => option.id === id)?.content || "")
        .filter(Boolean);
      const evidenceOptionBlocks = evidence.optionIds.flatMap(id => {
        const optionIndex = question.options.findIndex(option => option.id === id);
        return optionIndex < 0 ? [] : optionBlocks[optionIndex];
      });
      const sourceBlock = evidenceOptionBlocks.find(block => optionTexts.some(text => matcher.matches(block, text)))
        || blocks.find(block => optionTexts.some(text => matcher.matches(block, text)));
      return sourceBlock ? {
        ...evidence,
        sourceText: evidence.sourceText || optionTexts.join("\n"),
        sourceRef: {
          page: sourceBlock.sourceRef.page,
          blockId: sourceBlock.id,
          paragraph: sourceBlock.sourceRef.paragraph,
          run: sourceBlock.sourceRef.run,
        },
      } : evidence;
    });
    return {
      ...question,
      content: question.content.replace(/\[Hình ảnh\]/gi, "").trim(),
      promptSourceRefs: promptBlocks.map(block => block.id),
      options: options.map(option => ({ ...option, content: option.content.replace(/\[Hình ảnh\]/gi, "").trim() })),
      sourceRefs,
      answerEvidence,
    };
  });
  return { ...result, questions };
}
