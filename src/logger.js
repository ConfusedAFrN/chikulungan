
import { db, ref, push, serverTimestamp } from './firebase';


export const logEvent = (message, source = 'web') => {
  push(ref(db, 'logs'), {
    message,
    source,
    timestamp: serverTimestamp()
  });
};