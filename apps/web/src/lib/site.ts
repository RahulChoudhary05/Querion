/** Product + creator identity — used by the footer, maker section and structured data (SEO). */
export const SITE = {
  name: 'Querion',
  tagline: 'Master SQL on real data, judged like an interview.',
  repo: 'https://github.com/RahulChoudhary05/Querion',
};

export const AUTHOR = {
  name: 'Rahul Choudhary',
  role: 'Full Stack & AI Developer',
  location: 'India',
  bio: 'Full Stack & AI Developer building production-grade platforms and agentic AI / LLM-integrated systems — from system design to deployment.',
  email: 'rahulchoudhary.sk@gmail.com',
  github: 'https://github.com/RahulChoudhary05',
  linkedin: 'https://www.linkedin.com/in/rahulchoudhary210505/',
  education: 'B.E. Computer Science & Engineering, Chandigarh University',
  skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'FastAPI', 'Agentic AI', 'LLM integration', 'System design'],
  projects: [
    { name: 'MedoShield AI', blurb: 'Privacy-first neuro-motor monitoring with on-device pose estimation', url: 'https://medoshield.pages.dev/', code: 'https://github.com/RahulChoudhary05/MedoShield' },
  ],
};

/** schema.org Person for the creator (Google uses `sameAs` to connect the profiles). */
export const authorJsonLd = {
  '@type': 'Person',
  name: AUTHOR.name,
  jobTitle: AUTHOR.role,
  email: `mailto:${AUTHOR.email}`,
  url: AUTHOR.linkedin,
  sameAs: [AUTHOR.linkedin, AUTHOR.github],
  alumniOf: { '@type': 'CollegeOrUniversity', name: 'Chandigarh University' },
  knowsAbout: AUTHOR.skills,
};
