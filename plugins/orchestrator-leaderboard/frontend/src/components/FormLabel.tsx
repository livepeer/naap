import React from 'react';

interface FormLabelProps {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}

/** Field label — matches Leaderboard filter inputs and section label typography. */
export const FormLabel: React.FC<FormLabelProps> = ({
  children,
  htmlFor,
  className = '',
}) => (
  <label
    htmlFor={htmlFor}
    className={`block section-label-text mb-1.5 ${className}`.trim()}
  >
    {children}
  </label>
);
