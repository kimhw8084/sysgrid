import React, { Component, ErrorInfo, ReactNode } from 'react';
import { errorManager } from '../../stores/errorStore';
import { ErrorConsole } from './ErrorConsole';
import { FatalErrorState } from './ShellStates';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorSentinel extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Critical Runtime Error Captured:', error, errorInfo);
    errorManager.addError({
      message: error.message || 'The application could not be rendered',
      stack: error.stack,
      data: { componentStack: errorInfo.componentStack },
      type: 'frontend',
      severity: 'critical',
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <>
          <FatalErrorState />
          <ErrorConsole />
        </>
      );
    }
    return this.props.children;
  }
}
