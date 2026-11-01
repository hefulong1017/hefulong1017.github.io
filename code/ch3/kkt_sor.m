function [z, iter, residual] = kkt_sor(A, C, b, d, omega, z0, tol, maxIter, lambda)
    m = length(b);
    n = length(d);
    
    % 确保C是满秩的
    if rank(C) ~= size(C, 2)
        error('Constraint matrix C is not full rank.');
    end
    
    % 添加正则化项
    KKT = [A, C'; C, lambda * eye(n)];
    rhs = [b; d];
    z = z0;
    r = rhs - KKT*z;
    residual = norm(r);

    D = diag(diag(KKT));
    L = tril(KKT, -1);
    U = triu(KKT, 1);
    M = inv(D/omega + L);
    N = D*(omega-1)/omega - U;

    for i = 1:maxIter
        z = M * (N * z + rhs);
        r = rhs - KKT*z;
        residual = norm(r);
        if isnan(residual) || isinf(residual)
            disp('Residual became NaN or Inf, stopping iterations.');
            break;
        end
        if residual < tol
            break;
        end
    end
    iter = i;
end