/**
 * UI State Manager - Persists state across page navigation
 * Shared by upload.html and review.html
 */

class UIStateManager {
  constructor() {
    this.storageKey = 'journey_ui_state';
    this.pollingInterval = null;
  }

  /**
   * Save current UI state to sessionStorage
   */
  saveState(state) {
    const currentState = this.getState() || {};
    const merged = { ...currentState, ...state, lastUpdated: Date.now() };
    sessionStorage.setItem(this.storageKey, JSON.stringify(merged));
    console.log('UI State saved:', merged);
  }

  /**
   * Get current UI state from sessionStorage
   */
  getState() {
    const stored = sessionStorage.getItem(this.storageKey);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse UI state:', e);
        return null;
      }
    }
    return null;
  }

  /**
   * Clear UI state
   */
  clearState() {
    sessionStorage.removeItem(this.storageKey);
  }

  /**
   * Check if there's an active generation job
   */
  getActiveJob() {
    const state = this.getState();
    if (!state || !state.activeJob) return null;

    const { jobId, chapterId, startTime } = state.activeJob;
    const elapsed = Date.now() - startTime;

    // Jobs older than 30 minutes are considered stale
    if (elapsed > 30 * 60 * 1000) {
      this.clearActiveJob();
      return null;
    }

    return state.activeJob;
  }

  /**
   * Set active job
   */
  setActiveJob(jobId, chapterId) {
    this.saveState({
      activeJob: {
        jobId,
        chapterId,
        startTime: Date.now()
      }
    });
  }

  /**
   * Clear active job
   */
  clearActiveJob() {
    const state = this.getState();
    if (state) {
      delete state.activeJob;
      sessionStorage.setItem(this.storageKey, JSON.stringify(state));
    }
  }

  /**
   * Save progress information
   */
  saveProgress(progress) {
    this.saveState({ progress });
  }

  /**
   * Get saved progress
   */
  getProgress() {
    const state = this.getState();
    return state?.progress || null;
  }

  /**
   * Save workflow stage
   */
  saveWorkflowStage(stage) {
    this.saveState({ workflowStage: stage });
  }

  /**
   * Get workflow stage
   */
  getWorkflowStage() {
    const state = this.getState();
    return state?.workflowStage || null;
  }

  /**
   * Start polling for job status updates
   */
  startJobPolling(jobId, chapterId, onUpdate, onComplete, onError) {
    // Clear any existing polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/status/${jobId}`);
        if (!res.ok) {
          throw new Error(`Status check failed: ${res.status}`);
        }

        const status = await res.json();
        
        // Call update callback
        if (onUpdate) {
          onUpdate(status);
        }

        // Save progress
        this.saveProgress({
          status: status.status,
          progress: status.progress,
          message: this.getStatusMessage(status.status),
          timestamp: Date.now()
        });

        // Check if complete
        if (status.status === 'completed') {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
          this.clearActiveJob();
          if (onComplete) {
            onComplete(status, chapterId);
          }
        } else if (status.status === 'failed') {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
          this.clearActiveJob();
          if (onError) {
            onError(status.error || 'Job failed');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
        if (onError) {
          onError(error.message);
        }
      }
    };

    // Poll immediately, then every 5 seconds
    poll();
    this.pollingInterval = setInterval(poll, 5000);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Get human-readable status message
   */
  getStatusMessage(status) {
    const messages = {
      'pending': 'Queued...',
      'processing': 'Processing chapter...',
      'processing_text': 'Processing text content...',
      'extracting_text': 'Extracting text from PDF...',
      'analyzing_content': 'Analyzing content...',
      'planning_episodes': 'Planning episodes...',
      'generating_scripts': 'Generating scripts...',
      'packaging_results': 'Finalizing results...',
      'completed': 'Complete!',
      'failed': 'Failed'
    };

    // Handle episode-specific status
    if (status && status.startsWith('generating_episode_')) {
      const episodeNum = status.split('_')[2];
      return `Generating Episode ${episodeNum}...`;
    }

    return messages[status] || status;
  }

  /**
   * Fetch workflow status from server
   */
  async fetchWorkflowStatus(chapterId) {
    try {
      const res = await fetch(`/api/v1/chapter/${chapterId}/workflow-status`);
      if (!res.ok) {
        if (res.status === 404) {
          return null; // Old chapter, no workflow status
        }
        throw new Error(`Failed to fetch workflow status: ${res.status}`);
      }
      
      const workflowStatus = await res.json();
      this.saveWorkflowStage(workflowStatus.current_stage);
      return workflowStatus;
    } catch (error) {
      console.error('Failed to fetch workflow status:', error);
      return null;
    }
  }

  /**
   * Resume active job if page was navigated away
   */
  async resumeActiveJob(onUpdate, onComplete, onError) {
    const activeJob = this.getActiveJob();
    if (!activeJob) return false;

    const { jobId, chapterId } = activeJob;

    // Check if job still exists
    try {
      const res = await fetch(`/api/v1/status/${jobId}`);
      if (!res.ok) {
        this.clearActiveJob();
        return false;
      }

      const status = await res.json();
      
      if (status.status === 'completed') {
        this.clearActiveJob();
        if (onComplete) {
          onComplete(status, chapterId);
        }
        return false;
      } else if (status.status === 'failed') {
        this.clearActiveJob();
        if (onError) {
          onError(status.error || 'Job failed');
        }
        return false;
      } else {
        // Job still running, resume polling
        this.startJobPolling(jobId, chapterId, onUpdate, onComplete, onError);
        return true;
      }
    } catch (error) {
      console.error('Failed to resume job:', error);
      this.clearActiveJob();
      return false;
    }
  }
}

// Create global instance
const uiState = new UIStateManager();
