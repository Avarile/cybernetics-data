/** A skill the `/` picker offers. */
export interface IAgentSkillOption {
  name: string;
  description?: string | null;
}

/** Skills that match what follows a leading `/`. */
export const matchSkills = (value: string, skills: IAgentSkillOption[]) => {
  const m = /^\/([\w-]*)$/.exec(value.trim());
  if (!m) return [];
  return skills.filter((s) => s.name.startsWith(m[1].toLowerCase())).slice(0, 8);
};

/** A chat command the composer handles itself: start a new conversation. */
export const isClearCommand = (text: string) => /^\/(?:clear|new)$/i.test(text.trim());
