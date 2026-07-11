export const createAiStudyOutput = ({
  state,
  els,
  escapeHtml,
  renderMarkdown,
  renderAiEvidence,
  aiActionLabel,
  selectedAiSource,
  updateLibrarySaveButton,
  markLectureMilestone,
  addActivity,
  selectedDocumentTitle,
  updateStudyMaterialProgress,
  getQuizProgressFromSession,
  scheduleFlashcardProgressSave,
  showToast
}) => {
  const isAiSeparatorLine = (value = '') => /^[-*_=\s]{2,}$/.test(String(value || '').trim());

  const cleanAiLine = (value = '') => {
    const text = String(value || '').trim();
    if (isAiSeparatorLine(text)) return '';
    return text
      .replace(/^[-*•]\s*/, '')
      .replace(/^#{1,6}\s*/, '')
      .trim();
  };

  const stripAiLabel = (value = '', label = '') => cleanAiLine(value)
    .replace(new RegExp(`^${label}\\s*[:：-]\\s*`, 'i'), '')
    .trim();

  const splitAiSections = (output = '') => {
    const sections = [];
    let current = null;

    output.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      const normalized = cleanAiLine(line).replace(/:$/, '');
      const isHeading = /^(short summary|detailed summary|key points|things to remember|important terms|revision notes|simple explanation|real-life example|real life example|exam answer version|exam answer|very important|medium important|quick revision|what to revise first)$/i.test(normalized);

      if (isHeading) {
        current = { title: normalized, items: [], text: '' };
        sections.push(current);
        return;
      }

      if (!current) {
        current = { title: 'Study Output', items: [], text: '' };
        sections.push(current);
      }

      if (/^[-*•]\s+/.test(line) || /^\d+[).]\s+/.test(line)) {
        current.items.push(cleanAiLine(line));
      } else {
        current.text = `${current.text}${current.text ? '\n' : ''}${cleanAiLine(line)}`;
      }
    });

    return sections.filter((section) => section.title || section.text || section.items.length);
  };

  const parseQuizOutput = (output = '') => {
    const normalized = output.replace(/\r/g, '').trim();
    if (!normalized) return [];

    const blocks = normalized
      .split(/\n\s*(?=(?:Question\s*)?\d+\s*[).:-])/i)
      .map((block) => block.trim())
      .filter(Boolean);

    return blocks.map((block, index) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return null;

      let question = lines[0]
        .replace(/^(?:Question\s*)?\d+\s*[).:-]\s*/i, '')
        .trim();
      const options = [];
      let answer = '';
      let answerText = '';
      let explanation = '';
      let topic = '';

      lines.slice(1).forEach((line) => {
        const optionMatch = line.match(/^([A-D])\s*[).:-]\s*(.+)$/i);
        if (optionMatch) {
          options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
          return;
        }

        const answerMatch = line.match(/^Answer\s*[:：-]\s*([A-D])?\)?\s*(.*)$/i);
        if (answerMatch) {
          answer = (answerMatch[1] || '').toUpperCase();
          answerText = (answerMatch[2] || '').trim();
          return;
        }

        const explanationMatch = line.match(/^Explanation\s*[:：-]\s*(.*)$/i);
        if (explanationMatch) {
          explanation = explanationMatch[1].trim();
          return;
        }

        const topicMatch = line.match(/^Topic\s*[:：-]\s*(.*)$/i);
        if (topicMatch) {
          topic = topicMatch[1].trim();
          return;
        }

        if (!question) question = line;
        else if (!explanation && !/^Quiz/i.test(line)) explanation = line;
      });

      if (!question || /^quiz from your notes$/i.test(question)) return null;

      if (!answer && options.length && answerText) {
        const match = options.find((option) => option.text.toLowerCase().includes(answerText.toLowerCase()));
        if (match) answer = match.key;
      }

      return {
        id: `q-${index}`,
        question,
        options,
        answer,
        answerText,
        explanation,
        topic: topic || 'Study notes'
      };
    }).filter(Boolean);
  };

  const extractJsonPayload = (output = '') => {
    const text = String(output || '').trim();
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const start = Math.min(
      ...['{', '['].map((char) => {
        const index = text.indexOf(char);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      })
    );
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    const candidate = fenced?.[1] || (Number.isFinite(start) && end >= start ? text.slice(start, end + 1) : '');
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const normalizeQuizQuestions = (questions = []) => questions.slice(0, 20).map((question, index) => {
    const options = Array.isArray(question.options)
      ? question.options.map((option, optionIndex) => {
        if (typeof option === 'string') {
          return { key: String.fromCharCode(65 + optionIndex), text: option.trim() };
        }
        return {
          key: String(option.key || String.fromCharCode(65 + optionIndex)).trim().toUpperCase().slice(0, 1),
          text: String(option.text || option.label || option.value || '').trim()
        };
      }).filter((option) => option.key && option.text).slice(0, 6)
      : [];
    return {
      id: question.id || `q-${index}`,
      question: String(question.question || question.prompt || '').trim(),
      options,
      answer: String(question.answer || question.correctAnswer || '').trim().toUpperCase().slice(0, 1),
      answerText: String(question.answerText || '').trim(),
      explanation: String(question.explanation || question.reason || '').trim(),
      topic: String(question.topic || 'Study notes').trim()
    };
  }).filter((question) => question.question);

  const parseStructuredQuizOutput = (output = '') => {
    const parsed = extractJsonPayload(output);
    if (!parsed || typeof parsed !== 'object') return [];
    if (Array.isArray(parsed.questions)) return normalizeQuizQuestions(parsed.questions);
    if (Array.isArray(parsed)) return normalizeQuizQuestions(parsed);
    return [];
  };

  const parseFlashcardsOutput = (output = '') => {
    const lines = output.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
    const cards = [];
    let current = null;

    lines.forEach((line) => {
      if (isAiSeparatorLine(line)) return;

      if (/^Front\s*[:：-]/i.test(line)) {
        if (current?.front && current?.back) cards.push(current);
        current = { front: stripAiLabel(line, 'Front'), back: '', tag: 'Study notes' };
        return;
      }

      if (/^Back\s*[:：-]/i.test(line)) {
        if (!current) current = { front: '', back: '', tag: 'Study notes' };
        current.back = stripAiLabel(line, 'Back');
        return;
      }

      if (/^Tag\s*[:：-]/i.test(line)) {
        if (!current) current = { front: '', back: '', tag: 'Study notes' };
        current.tag = stripAiLabel(line, 'Tag') || 'Study notes';
        return;
      }

      if (current && current.back && !/^Flashcards/i.test(line)) {
        const cleanedLine = cleanAiLine(line);
        if (cleanedLine) current.back = `${current.back} ${cleanedLine}`.trim();
      }
    });

    if (current?.front && current?.back) cards.push(current);
    return cards.map((card, index) => ({
      ...card,
      front: sanitizeFlashcardText(card.front),
      back: sanitizeFlashcardText(card.back),
      tag: sanitizeFlashcardText(card.tag) || 'Study notes',
      id: `card-${index}`
    }));
  };

  const sanitizeFlashcardText = (value = '') => String(value || '')
    .split(/\r?\n/)
    .map((line) => cleanAiLine(line))
    .filter(Boolean)
    .join('\n')
    .replace(/(?:\s*[-*_=]{2,}\s*)+$/g, '')
    .trim();

  const parseStructuredFlashcardsOutput = (output = '') => {
    const parsed = extractJsonPayload(output);
    const cards = Array.isArray(parsed?.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : [];
    return cards.slice(0, 40).map((card, index) => ({
      id: card.id || `card-${index}`,
      front: sanitizeFlashcardText(card.front || card.question || ''),
      back: sanitizeFlashcardText(card.back || card.answer || ''),
      tag: sanitizeFlashcardText(card.tag || card.topic || 'Study notes') || 'Study notes'
    })).filter((card) => card.front && card.back);
  };

  const buildAiStudySession = (action = '', output = '', structured = null) => {
    if (structured?.type === 'quiz' && Array.isArray(structured.questions) && structured.questions.length) {
      return {
        type: 'quiz',
        questions: structured.questions,
        currentIndex: 0,
        answers: {},
        completed: false
      };
    }

    if (structured?.type === 'flashcards' && Array.isArray(structured.cards) && structured.cards.length) {
      return {
        type: 'flashcards',
        cards: structured.cards,
        currentIndex: 0,
        flipped: false,
        progress: {}
      };
    }

    if (structured?.type === 'structured' && Array.isArray(structured.sections)) {
      return {
        type: 'structured',
        action,
        sections: structured.sections,
        output
      };
    }

    if (action === 'quiz') {
      const structuredQuestions = parseStructuredQuizOutput(output);
      const questions = structuredQuestions.length ? structuredQuestions : parseQuizOutput(output);
      if (questions.length) {
        return {
          type: 'quiz',
          questions,
          currentIndex: 0,
          answers: {},
          completed: false
        };
      }
    }

    if (action === 'flashcards') {
      const structuredCards = parseStructuredFlashcardsOutput(output);
      const cards = structuredCards.length ? structuredCards : parseFlashcardsOutput(output);
      if (cards.length) {
        return {
          type: 'flashcards',
          cards,
          currentIndex: 0,
          flipped: false,
          progress: {}
        };
      }
    }

    return {
      type: 'structured',
      action,
      sections: splitAiSections(output),
      output
    };
  };

  const renderStructuredAiOutput = (session) => {
    const sections = session.sections?.length ? session.sections : [{ title: aiActionLabel(session.action), text: session.output, items: [] }];
    return `
      <div class="study-output study-output-${escapeHtml(session.action || 'general')}">
        <header class="study-output-head">
          <span>✦</span>
          <div>
            <strong>${escapeHtml(aiActionLabel(session.action))}</strong>
            <small>${escapeHtml(selectedAiSource() === 'selection' ? 'Focused on selected text' : 'Built from the current lecture')}</small>
          </div>
        </header>
        ${renderAiEvidence()}
        <div class="study-section-grid">
          ${sections.map((section) => `
            <article class="study-section-card">
              <h4>${escapeHtml(section.title)}</h4>
              ${section.text ? `<div class="study-section-body">${renderMarkdown(section.text)}</div>` : ''}
              ${section.items?.length ? `<ul class="study-section-list">${section.items.map((item) => `<li>${renderMarkdown(item)}</li>`).join('')}</ul>` : ''}
            </article>
          `).join('')}
        </div>
      </div>
    `;
  };

  const renderQuizSession = (session) => {
    const total = session.questions.length;
    const answeredCount = Object.keys(session.answers || {}).length;
    const score = session.questions.reduce((sum, question, index) => {
      const selected = session.answers?.[index];
      return sum + (selected && question.answer && selected === question.answer ? 1 : 0);
    }, 0);

    if (session.completed) {
      const weakTopics = session.questions
        .filter((question, index) => question.answer && session.answers?.[index] !== question.answer)
        .map((question) => question.topic)
        .filter(Boolean);
      const uniqueWeakTopics = [...new Set(weakTopics)].slice(0, 4);

      return `
        <div class="quiz-shell quiz-complete">
          <header class="quiz-hero">
            <span>✓</span>
            <div>
              <strong>Your score: ${score}/${total}</strong>
              <small>${score === total ? 'Perfect. You are ready to revise faster.' : 'Review mistakes, then turn weak topics into flashcards.'}</small>
            </div>
          </header>
          ${uniqueWeakTopics.length ? `
            <article class="quiz-review-card">
              <h4>Weak topics</h4>
              <div class="study-chip-row">${uniqueWeakTopics.map((topic) => `<span>${escapeHtml(topic)}</span>`).join('')}</div>
            </article>
          ` : ''}
          <div class="quiz-result-list">
            ${session.questions.map((question, index) => {
              const selected = session.answers?.[index];
              const correct = question.answer && selected === question.answer;
              return `
                <article class="quiz-review-card ${correct ? 'correct' : 'wrong'}">
                  <strong>Q${index + 1}. ${escapeHtml(question.question)}</strong>
                  <p>${correct ? 'Correct' : `Your answer: ${escapeHtml(selected || 'Not answered')}. Correct answer: ${escapeHtml(question.answer || question.answerText || 'See explanation')}`}</p>
                  ${question.explanation ? `<small>${escapeHtml(question.explanation)}</small>` : ''}
                </article>
              `;
            }).join('')}
          </div>
          <div class="quiz-actions">
            <button class="primary" data-quiz-action="restart" type="button">Retake quiz</button>
            <button class="ghost" data-ai-study-action="flashcards" type="button">Create flashcards</button>
          </div>
        </div>
      `;
    }

    const index = Math.min(session.currentIndex, total - 1);
    const question = session.questions[index];
    const selected = session.answers?.[index];
    const answered = Boolean(selected);
    const correct = answered && question.answer && selected === question.answer;

    return `
      <div class="quiz-shell">
        <header class="quiz-progress-head">
          <div>
            <strong>Interactive Quiz</strong>
            <small>Question ${index + 1} of ${total} · ${answeredCount}/${total} answered</small>
          </div>
          <span>${Math.round((answeredCount / total) * 100)}%</span>
        </header>
        <div class="quiz-progress-bar"><span style="width:${Math.max(5, (answeredCount / total) * 100)}%"></span></div>
        <article class="quiz-question-card">
          <span class="quiz-topic">${escapeHtml(question.topic || 'Study notes')}</span>
          <h4>${escapeHtml(question.question)}</h4>
          ${question.options.length ? `
            <div class="quiz-options">
              ${question.options.map((option) => {
                const isSelected = selected === option.key;
                const isCorrect = answered && question.answer === option.key;
                const isWrong = answered && isSelected && question.answer && question.answer !== option.key;
                return `<button class="quiz-option ${isSelected ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}" data-quiz-answer="${escapeHtml(option.key)}" type="button" ${answered ? 'disabled' : ''}><strong>${escapeHtml(option.key)}</strong><span>${escapeHtml(option.text)}</span></button>`;
              }).join('')}
            </div>
          ` : `
            <div class="quiz-reveal-card">
              <p>This quiz item has a written answer.</p>
              <button class="primary" data-quiz-answer="revealed" type="button" ${answered ? 'disabled' : ''}>Reveal answer</button>
            </div>
          `}
          ${answered ? `
            <div class="quiz-feedback ${correct || !question.answer ? 'correct' : 'wrong'}">
              <strong>${question.answer ? (correct ? 'Correct ✅' : 'Not quite') : 'Answer revealed'}</strong>
              <p>${escapeHtml(question.explanation || question.answerText || 'Review the answer and continue.')}</p>
            </div>
          ` : ''}
        </article>
        <div class="quiz-actions">
          <button class="ghost" data-quiz-action="prev" type="button" ${index === 0 ? 'disabled' : ''}>Previous</button>
          ${index < total - 1 ? `<button class="primary" data-quiz-action="next" type="button" ${!answered ? 'disabled' : ''}>Next</button>` : `<button class="primary" data-quiz-action="finish" type="button" ${!answered ? 'disabled' : ''}>Finish Quiz</button>`}
        </div>
      </div>
    `;
  };

  const renderFlashcardSession = (session) => {
    const total = session.cards.length;
    const index = Math.min(session.currentIndex, total - 1);
    const card = session.cards[index];
    const progressValues = Object.values(session.progress || {});
    const knownCount = progressValues.filter((value) => value === 'known').length;
    const hardCount = progressValues.filter((value) => value === 'hard').length;

    return `
      <div class="flashcard-shell">
        <header class="quiz-progress-head">
          <div>
            <strong>Flashcard Study Mode</strong>
            <small>Card ${index + 1} of ${total} · ${knownCount} known · ${hardCount} hard</small>
          </div>
          <span>${Math.round(((knownCount + hardCount) / total) * 100)}%</span>
        </header>
        <div class="quiz-progress-bar"><span style="width:${Math.max(5, ((knownCount + hardCount) / total) * 100)}%"></span></div>
        <div class="flashcard-container ${session.flipped ? 'flipped' : ''}" data-flashcard-action="flip">
          <div class="flashcard-inner">
            <div class="flashcard-front">
              <span>${escapeHtml(card.tag || 'Study notes')}</span>
              <strong>${renderMarkdown(card.front)}</strong>
              <small>Front side · click to flip</small>
            </div>
            <div class="flashcard-back">
              <span>${escapeHtml(card.tag || 'Study notes')}</span>
              <strong>${renderMarkdown(card.back)}</strong>
              <small>Back side · click to flip</small>
            </div>
          </div>
        </div>
        <div class="flashcard-actions">
          <button class="ghost" data-flashcard-action="prev" type="button" ${index === 0 ? 'disabled' : ''}>Previous</button>
          <button class="soft-button" data-flashcard-action="hard" type="button">Hard</button>
          <button class="primary" data-flashcard-action="known" type="button">Known</button>
          <button class="ghost" data-flashcard-action="next" type="button" ${index === total - 1 ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    `;
  };

  const renderAiStudyOutput = () => {
    if (!els.aiOutput) return;
    const session = state.aiStudySession;
    if (!session) {
      els.aiOutput.innerHTML = renderMarkdown(state.lastAiOutput || '');
      updateLibrarySaveButton();
      return;
    }

    if (session.type === 'quiz') {
      els.aiOutput.innerHTML = `${renderAiEvidence()}${renderQuizSession(session)}`;
      updateLibrarySaveButton();
      return;
    }

    if (session.type === 'flashcards') {
      els.aiOutput.innerHTML = `${renderAiEvidence()}${renderFlashcardSession(session)}`;
      updateLibrarySaveButton();
      return;
    }

    els.aiOutput.innerHTML = renderStructuredAiOutput(session);
    updateLibrarySaveButton();
  };

  const handleAiStudyOutputClick = (event) => {
    const session = state.aiStudySession;
    if (!session) return;

    const aiActionButton = event.target.closest('[data-ai-study-action]');
    if (aiActionButton) return;

    const quizAnswerButton = event.target.closest('[data-quiz-answer]');
    if (quizAnswerButton && session.type === 'quiz') {
      session.answers[session.currentIndex] = quizAnswerButton.dataset.quizAnswer;
      renderAiStudyOutput();
      return;
    }

    const quizActionButton = event.target.closest('[data-quiz-action]');
    if (quizActionButton && session.type === 'quiz') {
      const action = quizActionButton.dataset.quizAction;
      if (action === 'prev') session.currentIndex = Math.max(0, session.currentIndex - 1);
      if (action === 'next') session.currentIndex = Math.min(session.questions.length - 1, session.currentIndex + 1);
      if (action === 'finish') {
        session.completed = true;
        markLectureMilestone(state.selectedDocumentId, 'quizAttempted', {
          message: 'Quiz attempted'
        });
        addActivity({ action: 'completed quiz on', target: selectedDocumentTitle() });
        if (state.currentAiResultSavedId) {
          updateStudyMaterialProgress(state.currentAiResultSavedId, {
            quizProgress: getQuizProgressFromSession(session)
          }).catch((err) => showToast(err.message, true));
        }
      }
      if (action === 'restart') {
        session.currentIndex = 0;
        session.answers = {};
        session.completed = false;
      }
      renderAiStudyOutput();
      return;
    }

    const flashcardButton = event.target.closest('[data-flashcard-action]');
    if (flashcardButton && session.type === 'flashcards') {
      const action = flashcardButton.dataset.flashcardAction;
      if (action === 'flip') session.flipped = !session.flipped;
      if (action === 'prev') {
        session.currentIndex = Math.max(0, session.currentIndex - 1);
        session.flipped = false;
      }
      if (action === 'next') {
        session.currentIndex = Math.min(session.cards.length - 1, session.currentIndex + 1);
        session.flipped = false;
      }
      if (action === 'known' || action === 'hard') {
        session.progress[session.currentIndex] = action;
        markLectureMilestone(state.selectedDocumentId, 'flashcardsReviewed', {
          message: 'Flashcards reviewed',
          show: false
        });
        addActivity({ action: action === 'known' ? 'reviewed flashcard from' : 'marked hard flashcard from', target: selectedDocumentTitle() });
        session.currentIndex = Math.min(session.cards.length - 1, session.currentIndex + 1);
        session.flipped = false;
        scheduleFlashcardProgressSave();
      }
      renderAiStudyOutput();
    }
  };

  return {
    cleanAiLine,
    stripAiLabel,
    splitAiSections,
    buildAiStudySession,
    renderAiStudyOutput,
    renderStructuredAiOutput,
    handleAiStudyOutputClick
  };
};
