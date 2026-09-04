/**
 * LISA Local Disambiguator (Tier 1 — offline)
 * Uses compromise.js for NER + basic coreference resolution.
 * No API calls, no cost, runs entirely in browser.
 * Version: 0.52.6
 */

const LocalDisambiguator = {

  /**
   * Extract named entities using compromise NLP
   */
  extractEntities(text) {
    if (typeof nlp === 'undefined') {
      console.warn('[LISA] compromise.js not loaded, skipping local NER');
      return { people: [], orgs: [], places: [], topics: [] };
    }

    const doc = nlp(text);

    const people = [...new Set(doc.people().out('array'))].filter(p => p.length > 1);
    const orgs = [...new Set(doc.organizations().out('array'))].filter(o => o.length > 1);
    const places = [...new Set(doc.places().out('array'))].filter(p => p.length > 1);
    const topics = [...new Set(doc.topics().out('array'))].filter(t => t.length > 1);

    return { people, orgs, places, topics };
  },

  /**
   * Basic coreference resolution — replace pronouns with their likely referents.
   * Uses simple heuristics: last mentioned person/org before a pronoun.
   */
  resolvePronouns(text) {
    if (typeof nlp === 'undefined') return { text, resolved: false, replacements: 0 };

    const doc = nlp(text);
    const sentences = doc.sentences().out('array');
    let lastPerson = null;
    let lastOrg = null;
    let replacements = 0;
    const resolved = [];

    for (const sentence of sentences) {
      const s = nlp(sentence);
      const people = s.people().out('array');
      const orgs = s.organizations().out('array');

      // Track last mentioned entities
      if (people.length > 0) lastPerson = people[people.length - 1];
      if (orgs.length > 0) lastOrg = orgs[orgs.length - 1];

      let result = sentence;

      // Replace subject pronouns with last known person
      if (lastPerson) {
        const heRegex = /\b(He|She)\b(?!\s+said\b)/g;
        if (heRegex.test(result)) {
          result = result.replace(heRegex, `${lastPerson}`);
          replacements++;
        }
      }

      // Replace "it" / "they" with last org when contextually appropriate
      if (lastOrg) {
        const orgPronounRegex = /\b(It|They)\b(?=\s+(?:is|are|was|were|has|have|had|will|would|should|can|could|did|does|do)\b)/g;
        if (orgPronounRegex.test(result)) {
          result = result.replace(orgPronounRegex, `${lastOrg}`);
          replacements++;
        }
      }

      resolved.push(result);
    }

    return {
      text: resolved.join(' '),
      resolved: replacements > 0,
      replacements
    };
  },

  /**
   * Full local disambiguation pipeline.
   * Returns { text, entities, stats }
   */
  disambiguate(text) {
    const entities = this.extractEntities(text);
    const coref = this.resolvePronouns(text);

    const entityCount = entities.people.length + entities.orgs.length +
                        entities.places.length + entities.topics.length;

    return {
      text: coref.text,
      entities,
      stats: {
        entity_count: entityCount,
        people: entities.people.length,
        organizations: entities.orgs.length,
        places: entities.places.length,
        topics: entities.topics.length,
        coref_replacements: coref.replacements,
        resolved: coref.resolved,
        method: 'local-compromise'
      }
    };
  }
};

// Make available to other scripts
if (typeof window !== 'undefined') {
  window.LocalDisambiguator = LocalDisambiguator;
}
