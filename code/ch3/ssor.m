% SSOR 迭代
function x = ssor(A, b, omega, maxIter, tol)
    D = diag(diag(A));
    L = tril(A, -1);
    U = triu(A, 1);
    M = inv(D/omega + L) * (D*(2/omega - 1) - U);
    x = zeros(size(b));  % 初始猜测
    residual = norm(b - A*x);
    iter = 0;

    while residual > tol && iter < maxIter
        x = M * x + inv(D/omega + L) * b;
        residual = norm(b - A*x);
        iter = iter + 1;
    end
    disp(['SSOR Iterations: ', num2str(iter)]);
end