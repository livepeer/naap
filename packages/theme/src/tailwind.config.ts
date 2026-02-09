// Shared Tailwind CSS configuration for all apps
import { tailwindExtend } from './index';

export const sharedTailwindConfig = {
  content: [],
  theme: {
    extend: tailwindExtend,
  },
  plugins: [],
};

export default sharedTailwindConfig;
