function [x, iter, residual] = sor(A, b, omega, x0, tol, maxIter)
    n = length(b);
    D = diag(diag(A));
    L = tril(A, -1);
    U = triu(A, 1);
    
    % 使用 Jacobi 预处理
    M = inv(D);  % Jacobi 预处理
    A_precond = M * A;
    b_precond = M * b;

    M = inv(D/omega + L);
    N = D*(omega-1)/omega - U;
    x = x0;
    r = b_precond - A_precond*x;
    residual = norm(r);

    for i = 1:maxIter
        x = M * (N * x + b_precond);
        r = b_precond - A_precond*x;
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