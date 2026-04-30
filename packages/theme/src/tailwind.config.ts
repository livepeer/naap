// Shared Tailwind CSS configuration for all apps
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tailwindExtend = require('../tailwind-extend.cjs');

export const sharedTailwindConfig = {
  content: [],
  theme: {
    extend: tailwindExtend,
  },
  plugins: [],
};

export default sharedTailwindConfig;
