import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createRouter } from './src/api/router';
import { initStore } from './src/store';
import { initAuth } from './src/auth';
import { SECURITY_HEADERS } from './src/api/constants';
import { getCategories, createCategory, updateCategory, deleteCategory } from './src/api/categories';
import { getTransactions, createTransaction, deleteTransaction, updateTransaction } from './src/api/transactions';
import { getTargets, upsertTarget, deleteTarget } from './src/api/targets';
import { getPots, putPot } from './src/api/pots';
import { archivePot, unarchivePot } from './src/api/potArchive';
import { getTransactionsRange } from './src/api/transactionsRange';
import { reassignCategory } from './src/api/reassign';
import {
  getRecurring, createRecurring, updateRecurring, deleteRecurring, setRecurringHandled,
} from './src/api/recurring';
import { getAccounts, createAccount, updateAccount, deleteAccount, addBalance } from './src/api/accounts';
import { getTrash, restoreFromTrash } from './src/api/trash';
import { createPushSubscription, deletePushSubscription } from './src/api/push';

const router = createRouter();
router.get('/api/categories', getCategories);
router.post('/api/categories/{categoryId}/reassign', reassignCategory);
router.post('/api/categories', createCategory);
router.put('/api/categories/{categoryId}', updateCategory);
router.delete('/api/categories/{categoryId}', deleteCategory);
router.get('/api/transactions', getTransactions);
router.post('/api/transactions', createTransaction);
router.delete('/api/transactions/{yearMonth}/{transactionId}', deleteTransaction);
router.put('/api/transactions/{yearMonth}/{transactionId}', updateTransaction);
router.get('/api/transactions/range', getTransactionsRange);
router.get('/api/targets', getTargets);
router.put('/api/targets/{categoryId}', upsertTarget);
router.delete('/api/targets/{categoryId}', deleteTarget);
router.get('/api/pots', getPots);
router.put('/api/pots/{categoryId}', putPot);
router.post('/api/pots/{categoryId}/archive', archivePot);
router.post('/api/pots/{categoryId}/unarchive', unarchivePot);
router.get('/api/recurring', getRecurring);
router.post('/api/recurring', createRecurring);
router.put('/api/recurring/{recurringId}', updateRecurring);
router.delete('/api/recurring/{recurringId}', deleteRecurring);
router.post('/api/recurring/{recurringId}/handled', setRecurringHandled);
router.get('/api/accounts', getAccounts);
router.post('/api/accounts', createAccount);
router.put('/api/accounts/{accountId}', updateAccount);
router.delete('/api/accounts/{accountId}', deleteAccount);
router.post('/api/accounts/{accountId}/balances', addBalance);
router.get('/api/trash', getTrash);
router.post('/api/trash/restore', restoreFromTrash);
router.post('/api/push/subscriptions', createPushSubscription);
router.delete('/api/push/subscriptions', deletePushSubscription);

const INTERNAL_ERROR = JSON.stringify({ error: 'Internal server error' });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log('Request:', {
    // Log the templated route, not the raw path — path segments can carry
    // resource IDs that the spec's Logging section says must never be logged.
    route: event.requestContext.routeKey,
    method: event.requestContext.http.method,
    sourceIp: event.requestContext.http.sourceIp,
  });

  // A failure inside a handler is the server's, not an authentication failure, so it is kept apart
  // from the 401s below and answered with a generic body; the detail goes to the logs only.
  try {
    const auth = await initAuth();
    const publicResponse = await auth.handlePublic?.(event);
    if (publicResponse) return publicResponse;

    const result = await auth.authenticate(event);
    if ('rejection' in result) return result.rejection;

    await initStore();
    return await router.dispatch(event, result.userId);
  } catch (error) {
    console.error(`Unhandled error in ${event.requestContext.routeKey}:`, error instanceof Error ? error.message : String(error));
    return { statusCode: 500, headers: SECURITY_HEADERS, body: INTERNAL_ERROR };
  }
};
