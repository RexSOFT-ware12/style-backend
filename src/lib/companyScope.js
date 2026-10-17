function companyQuery(companyId, legacyUserId) {
  return companyId ? { companyId } : { userId: legacyUserId };
}
module.exports = { companyQuery };
