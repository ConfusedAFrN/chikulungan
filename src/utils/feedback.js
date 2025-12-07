// src/utils/feedback.js
let showMessage = () => {};
let setLoading = () => {};

export const toast = (msg, severity = 'info') => showMessage(msg, severity);
export const setGlobalLoading = (bool) => setLoading(bool);

// Internal — used by GlobalFeedback component
export const registerFeedback = (showMsg, setLoad) => {
  showMessage = showMsg;
  setLoading = setLoad;
};